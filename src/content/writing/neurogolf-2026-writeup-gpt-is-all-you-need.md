---
title: "NeuroGolf 2026 Writeup:GPT is all you need"
description: "kaggle neurogolf 2026 复盘，最终名次104/2963，银牌。"
date: 2026-09-17
tags:
  - kaggle
  - onnx
  - writeup
draft: false
featured: true
---

依然是拖了很久的一篇writeup。

这个比赛一句话概括，就是优化400个onnx网络的parameter和memory。在ai时代这个比赛相比于[orbit wars](/writing/orbit-wars-writeup-bc-is-all-you-need/)有点过于水了，所以writeup也没什么好写的()。中间几天摆烂了没有管，本来排名应该能更高一点。最抽象的是这比赛结束前几天甚至还爆了一波节奏，导致整场比赛最有意思的地方居然是吃瓜🍉...

一些经验：

- 对于这种由一堆比较独立的小task组合起来的比赛，一定要严格限制让ai一次只优化一个task，不然极其容易出现ai在一个task优化不出来以后，不继续思考而是直接跑去优化另一个，然后陷入无限循环最后得到0个提升。
- “不仅仅需要 AGENTS.md，还需要为 AI 准备一套文档和顺手的工具链”——by Controlvector
- 对于这种比较独立又不吃很多资源的小task优化，如果能为AI准备好顺手的文档和工具链，那么网页版GPT是一个非常不错的选择，不仅不吃额度而且体感上更加聪明，只要把准备好的文档和工具链以及一个task打包丢给它，它直接在网页端容器里面干活就能搞出来很不错的结果。当然现在似乎网页版也在降智，这就另说了()
- **谎报目标是最关键的一手**。一定要敢于大胆设目标，设激进的目标。比如我们有一个task现在的cost是2000，在让AI优化的时候，不把已有的解丢给它，直接让它从头开始优化，但是骗它我们手里现在有一个cost=1000的解，让他优化出一个更好的，**很多时候都能成功**，成功了就是保底2倍的提升。
- 即使在这种比赛，人类智慧也非常重要。我们由于缺少人类智慧，AI忽视了LpPool这个算子以后我们也没有发现，导致丢掉了几个满分解，少吃了很多分。
- GPT is all you need.

最后还是附上codex写的完整writeup供参考。

---

## NeuroGolf 2026 复盘：从并行解题到可进化的优化系统

### 摘要

我们最终取得 **104 / 2963，银牌，前 3.51%**。

这不是靠一个通用 ARC 模型，也不是靠一次性的 ONNX 技巧。我们的最终工作流是：用 `src/package_task_for_gpt.py` 为单题打包生成器、数据、设计文档、方法库和工具；把 `prompt.md` 中的模板分别用于 ChatGPT 网页窗口和本地 Codex 窗口；并行推进多个 task；通过本地与 online verify 选择模型；最后用归档 prompt 把 builder、writeup 和真正可复用的方法沉淀回仓库。

从当前仓库口径看，这条路线把 400 题的参考总分从约 **7159.85** 提升到 **7471.68**，净增约 **311.83**；343 题出现了可见分数提升，最终留下 400 个 SOTA ONNX、317 个 `gen/` builder、230 个 `gpt_output/` task 工作目录，以及 142 条带结构化索引的方法卡。结果证明，LLM 可以成为有效的网络设计与 code-golf 合作者，而不只是代码补全器。

但和冠军及第 5 名的公开材料对照后，差距也很明确：我们已经搭出了正确的基本循环，却没有把它继续升级为一个具有紧凑 task memory、候选数据库、任务聚类、横向迁移、context 选育、manager agent 和全局运行时组合优化的完整系统。我们更多是在“并行解很多题”，顶队则在“持续优化解题系统本身”。

### 1. 比赛究竟在优化什么

NeuroGolf 要求为 400 个 ARC-AGI transformation 分别提交一个 ONNX。输入和输出都是固定外壳 `[1, 10, 30, 30]` 的 one-hot tensor，但真实网格尺寸、颜色、对象和规则各不相同。正确性只是第一道门，真正的排名来自每题图的 cost：

```text
cost = params + intermediate_memory_bytes
points = max(1, 25 - ln(max(1, cost)))
```

比赛后期 MAC 已不计费。这改变了“好网络”的定义：计算很重并不可怕，昂贵的是 initializer 元素和有名字的中间 tensor。`input` 和 `output` 本身不计 activation memory，因此最强的图常常把大量逻辑压进一个直接写 `output` 的 `Einsum`、卷积、采样或 gather，而不是用可读的多阶段流水线。

这使比赛同时包含三类问题：

1. 从 ARC-GEN 源码中还原真实 transformation，而不是只拟合有限样例。
2. 把离散、几何和对象逻辑编译成受限 ONNX 算子图。
3. 在正确性、cost、运行时间、ONNX Runtime 行为和线上 profiler 之间做工程权衡。

我们后期形成的设计原则——generator-first、label-first、裁剪后计算、低字节 dtype、终端 one-hot、Einsum-first、online shape 单独计价——正是对这三个问题的直接回应。

### 2. 我们最后真正使用的工作流

#### 2.1 任务打包

`package_task_for_gpt.py` 为每题生成独立 zip，核心内容包括：

- `arc-gen/tasks/taskNNN.py` 与 `arc-gen/common.py`，作为规则和生成分布的权威来源；
- `data/taskNNN.json`，用于公开样例验证；
- `docs/design_onnx.md`、方法总览、方法索引、数学建模、Einsum、局部算子、peephole、dtype、online shape 等设计知识；
- scorer、evaluator、静态 cost、任务摘要、候选 ledger、失败摘要、Einsum 顺序搜索、initializer 分解和 lint 工具。

这一步解决了网页窗口无法直接访问完整本地仓库的问题，也让本地与网页 agent 接收到大体一致的技术规范。

#### 2.2 网页版与本地 Codex 分工

`prompt.md` 保留了最终使用的三类 prompt。

网页版任务窗口需要自行建立 ONNX 环境，并适应约 33 秒的单命令限制。长验证通过分批脚本续跑，长训练则被拆成短轮次和 checkpoint。网页端适合大规模单题独立采样：上传 task pack，粘贴模板，等待一个完整结果，再手工下载候选。

本地 Codex 使用已经配置好的 `.venv`，能进行更长的验证、内存监控和本地工具调用，也更适合复杂的迭代优化。多个网页窗口与本地窗口同时工作，形成了以 task 为粒度的人工编排并行。

两类 prompt 的共同要求很有辨识度：

- 必须读 generator 的 `generate()` 和 `validate()`，先理解规则；
- 必须先估算架构 cost，反复强调不要从差架构开始做微调；
- 必须完整考虑数学化和 Single-Einsum 方案；
- 高阶 Einsum 过慢时应优化 operand order，而不是因为慢就放弃；
- 使用方法库避免重新发现已有技巧；
- 保存实验日志和不同 builder，避免上下文压缩后丢失轨迹；
- 达标后仍继续做 peephole；
- 同时保留高正确率主版本和低 cost gamble 版本，交给 online verify 决策。

我们还会虚报一个更强的 SOTA 或给出很激进的目标，迫使 agent 跳出“只要略有提升就停止”的行为模式。冠军后来公开的经验表明，强硬的分数目标确实会显著增加 architecture rewrite 的概率；这一点我们判断对了。

#### 2.3 验证、选择和 online feedback

单题 worker 会维护候选和实验日志，先通过 validate 与随机 ARC-GEN 样本，再比较 cost。网页端无法 online verify，因此动态 shape 候选只能附上 metadata claim，回到本地补齐 online shape 参数并验证。

我们没有把近似方案视为失败。若 95% 以上正确率能换来显著 cost 降低，就作为 gamble 与主版本并行送验。只要最终通过 online verify，它就是对真实评分分布有效的成功模型。这个做法为很多难以精确表达的 task 提供了合理的风险—收益交换。

#### 2.4 归档与方法飞轮

online verify 通过后，ONNX 进入 `sota/`，可重建脚本进入 `gen/`，原始工作区和 writeup 留在 `gpt_output/` 或 `codex_output/`。归档者重新阅读设计文档、ARC-GEN、builder、ONNX 和 writeup，再判断新知识应当：

- 合并到已有方法卡；
- 作为真正有增量的信息补充例子；
- 或建立新方法卡。

方法库只收成功、可复用的正面经验。负面实验不进入全局方法库，以免让已经验证的设计知识被噪声淹没。

最终形成的 `docs/method_index.json` 有 142 条方法，其中 122 条标为 stable，20 条 experimental；47 条来自 Einsum 优化，29 条来自 peephole，另外覆盖局部算子、数学方法和架构设计。这是我们最有长期价值的产出。

### 3. 结果与仓库证据

#### 3.1 从 baseline 到最终 SOTA

用当前 `baseline/` 的静态 cost 与 `outputs/ref_scores.json` 的最终参考口径比较，提升最大的部分 task 如下，数值均是仓库内参考口径：

| Task    | baseline | final |  提升 |    cost 变化 |
| ------- | -------: | ----: | ----: | -----------: |
| task067 |    21.15 | 25.00 | +3.85 |       47 → 0 |
| task293 |    17.84 | 21.31 | +3.47 |    1290 → 40 |
| task197 |    17.14 | 20.30 | +3.16 |   2602 → 110 |
| task350 |    15.89 | 18.94 | +3.05 |   9038 → 428 |
| task161 |    16.44 | 19.38 | +2.94 |   5217 → 275 |
| task087 |    20.50 | 23.39 | +2.89 |       90 → 5 |
| task215 |    17.15 | 19.99 | +2.84 |   2562 → 150 |
| task205 |    14.56 | 17.36 | +2.80 | 34178 → 2084 |
| task078 |    17.84 | 20.59 | +2.75 |    1293 → 82 |
| task055 |    14.83 | 17.58 | +2.75 | 26225 → 1676 |

这说明我们的系统既能发现零 cost 的特殊解，也能把复杂题降两个数量级。银牌并不是靠少数 easy task 堆出来的，而是对整个 task portfolio 的持续改进。

#### 3.2 我们做对了什么

第一，**把 generator 当规格，而不是把样例当规格**。这显著减少了只会通过公开格子的伪解，也使概率近似能针对真实生成分布设计。

第二，**把架构设计知识产品化**。设计文档、方法卡、tag、router、索引、candidate ledger 和专用工具把零散经验变成了 agent 可消费的资产。方法库不是赛后补文档，而是进入下一轮任务包的工作部件。

第三，**同时利用网页端和本地端的不同供给**。网页 ChatGPT 提供高质量长思考和横向吞吐，本地 Codex 提供可控环境、长验证和深度迭代。最终冠军也采用了几乎相同的双通道组合，说明方向是正确的。

第四，**很早抓住 metric 的结构**。终端输出免费、MAC 免费、initializer 按元素计数、dtype 只影响 activation bytes、Einsum 可把计算藏在输出节点，这些认识贯穿了后续优化。

第五，**允许经过线上证实的概率解**。这不是放松标准，而是正确利用比赛的生成分布和评分方式。关键在于主版本、gamble、online verify 和归档状态要分开管理。

### 4. 第 5 名开源仓库：代码层面对比

第 5 名 Claudex 的[赛后分享](https://www.kaggle.com/competitions/neurogolf-2026/writeups/6th-place-solution-claudex)与[开源仓库](https://github.com/PNTAN17/neurogolf)给出了完整的对照组。他们同样使用 Codex 与网页 ChatGPT、task zip、score-band pattern library、ARC-GEN、builder 和严格验证；区别主要在执行覆盖和压缩深度。

#### 4.1 他们的工作流

Claudex 把 400 题分给两个小组，每组 200 题，同时跑 Codex stream 与 web stream；每隔一两天交换任务区间。交换的意义不是简单负载均衡，而是让不同 prompt、算子偏好和搜索方向重新攻击已经“看似收敛”的题。

每次只晋升分数更高或同分更快的候选。LB 0 分、处理错误和 timeout 会回写为 task-specific warning。其 prompt 要求同时重打两套现有实现，以最强者作为 baseline；至少尝试两种 materially different formulation；生成 1000 个 fresh ARC-GEN 样本并要求零失败；风险 task 用 singleton submission 定位。

发布仓库还保留：

- 400 个确定性的 `optimize_final/build_taskNNN.py`；
- 400 个 `info_task/info_taskNNN.txt` dossier；
- `patterns.md`，按已达分数段组织 ARC family、算子 idiom 和 exemplar；
- `score.csv`，作为 task ledger；
- `prompt.txt` 与 `requirement.md`，把 source precedence、验证和 promotion policy 写死。

我们的归档更强调“成功方法的精确知识”，他们的 dossier 更强调“下一位 worker 立刻接手这道题”。两者并不冲突，但后者在持续迭代中的 token 效率更高。

#### 4.2 全量图结构对比

我在同一 ONNX Python 环境中重建了其 400 个 builder，并读取我们的 400 个 `sota/` ONNX。统计如下：

| 图结构指标               | 我们 | rank5 |
| ------------------------ | ---: | ----: |
| 最终 task 数             |  400 |   400 |
| 可重建 builder 数        |  317 |   400 |
| 单节点模型               |  137 |   214 |
| 节点数中位数             |  6.5 |     1 |
| 节点数 ≥ 20 的 task      |  118 |    73 |
| 无 initializer 的 task   |    4 |     9 |
| 最终节点为 Einsum        |  192 |   275 |
| 最终节点为 QLinearConv   |   10 |    52 |
| 最终节点为 ConvInteger   |   22 |    29 |
| 最终节点为 ConvTranspose |    3 |    20 |

双方都已理解“让最后一个节点直接写 `output`”；400 题都满足这一点。差距在于 rank5 更经常把**整个规则**压到最后一个节点，而我们更多只是把已有多阶段图的 renderer 接到 `output`。

rank5 的 214 个单节点模型中，184 个是单 `Einsum`。其高阶 Einsum 也明显更激进：全仓库 762 个 Einsum 中有 469 个含至少 10 个 operand，最大达到 977 个；我们的 660 个 Einsum 中只有 141 个达到 10 operand，最大 99 个。大量算术被转移到了不计 MAC 的 contraction 内，代价则通过 operand order 和专门的运行时验证处理。

#### 4.3 九个满分案例：怎样把规则压到计分器的下限

##### task053：借一行真黑色完成无参数下移

task053 的真实网格固定为 `3×3`，彩色活点只会出现在前两行；输出把它们向下移动一格。最上方新出现的一行不是 padding，而是 ARC 意义上的黑色，因此必须输出 channel 0 的 one-hot，不能简单补 zero-hot。

我们的模型用长度 30 的 `Gather` row index 实现置换，只有一个节点、零 memory，但索引 initializer 仍计 30 params。

rank5 的 [`build_task053.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task053.py) 把 `MaxPool` 的 vertical window 设计为：输出第 0 行只看到输入第 2 行，输出第 1 行看到输入第 0 行，输出第 2 行看到输入第 1 行，后续行只落在 padding。输入第 2 行由 generator 保证全黑，正好成为免费的黑色源；负 stride、dilation 和 pads 都是零 cost 属性。这里同时利用了两种边界语义：**in-grid black 提供 channel-0 one-hot，out-of-grid padding 提供 zero-hot**。

##### task067：用输入本身生成可变尺寸 mask

task067 的输入是高度为 `size`、宽度为 `3×size` 的三个 panel。左右 panel 都是原图，中间 panel 可能上下翻转，输出只需复制左侧 `size×size` 原图。

rank5 的 [`build_task067.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task067.py) 使用：

```text
Einsum("nchw,ndwk->nchw", input, input)
```

第一个 operand 直接提供左上区域的颜色。第二个 operand 对颜色与列求和，并把输出列索引 `w` 借作输入行索引：当 `w < size` 时该行存在，求和为正；当 `w >= size` 时落到 zero-hot padding，求和为零。于是同一个输入同时充当数据和动态 width mask，不需要 `Shape`、`Range`、比较或常量。输出幅值不是严格 1，但最终只检查 `> 0`，所以语义完全正确。我们的 task067 已采用同等 cost-0 思路，也是九题中双方共同达到满分的三题之一。

##### task087 与 task140：`LpPool` 作为反向 sampler

两题的 generator 不同，但最终规则都是固定 `3×3` 旋转 180°。task087 允许任意三色图；task140 只显式填充原图上三角的一部分，其余为黑色，旋转后落到相应下三角。对 ONNX 来说，它们是同一个空间置换。

我们的两个模型都用单 `RoiAlign`，cost 已降到 5，但仍需要 ROI 坐标和 batch index initializer。

rank5 的 [`build_task087.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task087.py) 和 [`build_task140.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task140.py) 都把 kernel 为 `1×1` 的 `LpPool` 当成纯 sampler。两个空间轴使用 `stride=-1`，pads 把输出 `(r,c)` 映射到输入 `(2-r,2-c)`；`r` 或 `c` 超过 2 后采样落到网格外并输出零，自动满足 30×30 外壳的 zero-hot padding。`p=1` 或 `p=2` 在单个非负 one-hot 样本上都保持原值，所以全部逻辑都进入免费属性。

##### task129：一枚 scalar 买到满分的 float32 众数门

task129 的 `3×3` 输入保证有一个颜色出现 3 次，其他颜色最多出现 2 次；输出用这个众数颜色填满整个 `3×3`。我们的实现已经很紧凑：`GlobalAveragePool → Hardmax → Einsum`，无参数，但两个中间 tensor 合计 cost 80。

rank5 的 [`build_task129.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task129.py) 只保存一个 float32 scalar `a`，在终端 `Einsum` 中把每个颜色的空间计数放大为 20 次乘积，即近似形成 `(a × count[color])^20`。`a` 被校准到：count 2 的结果在 float32 下溢为 0，count 3 仍为正。另一个输入副本对颜色求和，提供真实 `3×3` 内为 1、padding 为 0 的 occupancy mask。最终只有众数 channel 在真实网格内大于 0。

它的 cost 是 1 而不是 0，但评分同样是 25。这个案例给出一个重要的停止条件：**当 cost 已到 1 时，继续消灭最后一个 scalar 不增加任何分数；应优先选择更稳定、更快的表达。**

##### task135：把二维颜色编码替换成零成本稀疏采样

generator 的规则只是把固定 `9×9` 输入的右上 `3×3` 裁到输出左上角。我们的 builder 先用 `ConvTranspose` 把 10 色 one-hot 压成二维正多边形颜色码，再用 `Conv` 分类并 pad 回完整输出：2 个节点、30 params、72 bytes intermediate，cost 102，约 20.38 分。

rank5 的 [`build_task135.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task135.py) 发现根本不必重新编码颜色：`LpPool(p=2)` 的 `3×3` dilated window 被安排成每个有效输出位置只有一个采样点落在真实 `9×9` 区域，其余 tap 全落在 padding。one-hot 值是 0 或 1，L2 pooling 因而原样保留该像素。负 stride、dilation 和 pads 同时完成裁剪、放置与输出外清空，无 initializer、无 intermediate。

task087/140 用的是 `1×1` 反向采样，task135 则进一步说明：只要能保证每个 window 中至多一个有效源点，更大的 dilated pooling 仍可作为精确的 gather/crop。

##### task179 与 task241：先检查整个任务是否就是一个免费置换

task179 是普通方阵转置，单个 `Transpose(perm=[0,1,3,2])` 即为完整程序。输入真实区域是方形，30×30 zero-hot padding 在转置后仍是 padding，因此不需要额外 shape mask。

task241 的表面描述更复杂：灰色主对角线固定，彩色点随机出现在下三角，输出把彩色点映射到上三角。但 generator 让其余真实单元保持黑色，因此整个输出恰好就是输入矩阵转置。rank5 的 [`build_task179.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task179.py) 与 [`build_task241.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task241.py) 都是无参数、无中间 tensor 的单 `Transpose`。我们的两题也已达到相同满分。

task241 的可复用经验是：不要只按“移动彩色对象”翻译规则；先检查 generator 对所有背景位置的约束，复杂的稀疏移动可能等价于整个 tensor 的标准轴置换。

##### task326：用 30×30 外壳制造免费的裁剪边界

task326 的输入高宽可变，但输出永远是左上 `2×2`。我们的单 `Einsum` 已经没有 intermediate，却需要两个共享的长度 30 spatial mask，去掉重复后仍有 30 params，cost 30。

rank5 的 [`build_task326.py`](https://github.com/PNTAN17/neurogolf/blob/10e1a1b79d376056c208b89f9d31607d9116c50a/optimize_final/build_task326.py) 使用 kernel `2×2`、dilation 30、stride -29 的 `MaxPool`。输出坐标 0 和 1 的每个轴都只有一个 tap 命中输入坐标 0 或 1，另一个 tap 落到 30×30 边界外；后续输出坐标的 tap 全部越界。这样直接复制左上 `2×2`，并把其余输出变成 zero-hot，无需显式 mask。

这和 task053/135 属于同一大类：**把固定 30×30 外壳、负 padding、负 stride 和 dilation 共同编译成索引表，索引存在于属性而非 initializer 中。**

##### 九题共同揭示的满分搜索顺序

这九题不是九个互不相关的奇技淫巧，可以归纳出一条很具体的满分检查流程：

1. 判断 transformation 是否等价于整个 tensor 的标准置换，如 `Identity` 或 `Transpose`。
2. 若是固定 crop、flip、shift 或小区域抽取，尝试把 `MaxPool` / `LpPool` 退化成每个 window 只有一个有效 tap 的 sampler；让 stride、dilation、pads 承载索引。
3. 明确区分真实黑色 one-hot 与外壳 zero-hot：前者可作为免费背景源，后者可作为免费清空和边界 sentinel。
4. 若输出尺寸依赖输入真实 shape，优先尝试从输入 occupancy 自身生成 mask，而不是存 30 元素坐标或 mask。
5. 若规则只差一个小离散分类，检查能否用终端高阶乘积、float32 下溢或阈值行为压到一个 scalar。cost 1 已经满分，无需为形式上的 cost 0 牺牲可靠性。
6. 只有在这些零/一成本路线都不成立后，才进入低秩编码、量化 classifier 和多阶段图。

从我们的对应实现看，task067、179、241 已经满分；task087/140 只差把 5 参数 `RoiAlign` 改写为 attribute-only sampler；task053/326 只差消灭长度 30 的索引或 mask；task135 需要识别 pooling-as-gather；task129 则需要从显式 `Hardmax` 切换到数值阈值。九题合计仍有约 **19.02 分** 的仓库内差距，其中绝大部分来自“参数已经很少，但还没有继续问能否把索引或分类器写进免费算子语义”。

### 5. 冠军公开方案：他们优化的是 agent 组织本身

#### 5.1 用 task notes 消灭重复发现

每位冠军 worker 会收到一个预烘焙 task header：样本数、shape、palette、对称性探针、现有 cost、节点和 initializer 摘要、archetype、同 family 的中位 cost、规则草稿及置信度。上一位 worker 再附上尝试、有效发现和 dead end。

我们的 task pack 默认不包含当前 `sota/taskNNN.onnx`、`gen/taskNNN.py` 或上一轮 task note，只提供 generator、data、全局方法库和工具。因此新 worker 虽然知识很丰富，却仍需重新定位当前实现和 task 状态。

更重要的是上下文密度。当前默认包中的 26 个 context 文件和 18 个工具源码合计约 **1.57 MB、31800 行，粗略相当于 39 万 token**，尚未计算 task data 与 generator。方法索引的 Markdown 与 JSON 还存在信息重复。相比之下，冠军先把 task facts 和相关知识压成短 briefing，再让 worker 深读必要材料。我们解决了“知识不存在”，但还没有充分解决“知识太多时如何命中”。

#### 5.2 垂直探索与横向迁移交替

冠军把 pipeline 明确分成两种：

- **vertical single-task exploration**：一个单轮、长思考 worker 深挖一题，负责打破局部最优和发现新技巧；
- **horizontal multi-task exploitation**：Codex 或 Claude 读取最新 cookbook 和 task clustering，把新技巧批量迁移到相似任务。

两者交替为：单题探索 → 分析 trajectory、更新 cookbook → 多题迁移 → 再循环。

我们的多窗口并行主要提高了吞吐，每个窗口仍以自己的 task 为边界。方法归档会把成功知识带回下一批 task，但缺少一个显式的“新方法 × 相似 task 集合”扫描阶段。因此一项后期发现往往只能等到相关题再次被人工挑中，而不能立刻产生组合收益。

#### 5.3 Self Evolving Prompts 与 manager agent

冠军并不把 prompt 当静态文本。他们让多个 agent 参加四小时 mini-contest，目标是最大化总 ONNX LB gain；不同 agent 在任务选择、深挖时长、资源利用和失败恢复上形成不同 context。人类在过程中指导，并让 agent 赛后自评。三轮后选出表现最佳的 context，将该 agent 晋升为 manager，读取其他本地 worker 的日志、观察结果并向会话流注入指导，同时让它更新 cookbook、培训新 worker。

这里进化的不是一句 prompt，而是完整 conversation/tool history 形成的工作人格。我们的 prompt 和方法库会进化，但每个窗口的有效 context 基本随会话结束而丢失；我们归档的是结果知识，没有选育“哪种 agent 行为最会持续拿分”。

冠军也明确区分了本地与网页：manager 只管理共享文件夹中的 Codex CLI / Claude Code CLI worker；ChatGPT 仍是手工上传 `tar.gz`、单轮运行、手工下载。这和我们的网页工作流相似，说明不需要自动抓取网页界面也能建立高效系统。

#### 5.4 候选数据库与运行时组合优化

高分单图可能非常慢。冠军用 dashboard 保存每题所有候选的 score 和 runtime，并有专门 agent 在保持分数的前提下重写慢图。最终提交不是逐题无条件取最高分，而是在总运行时间约束下做 Multiple-Choice Knapsack Problem：每题从多个“分数—时间”候选中选一个。他们同时准备了约 30 分钟的最高分组合和约 18 分钟、LB 8310 的快速组合。

我们有单题 candidate ledger、Einsum operand-order 搜索和主版本/gamble online verify，微观运行时意识并不弱；缺少的是跨 400 题的候选数据库与 portfolio selector。直到最后，分数优化和运行时优化仍主要是逐题问题，而冠军把它们变成了全局资源分配问题。

### 6. 结论

104 / 2963 的银牌说明我们的核心判断是有效的：LLM 可以阅读程序化 task 规格，设计极小 ONNX，进行 cost-aware 搜索，并通过方法归档形成真实的知识复利。我们并不缺少好想法；方法库、dynamic shape 体系、Einsum 工具和多窗口工作流都达到很高的工程密度。

和顶队相比，我们少走的不是最后几个 peephole，而是从“有方法库的并行 agent”到“会学习如何组织 agent 的优化平台”这一步。第 5 名把极端压缩覆盖到几乎所有题，冠军再用 task memory、聚类迁移、context evolution、manager 和全局候选选择把这种能力规模化。

### 资料

- rank5：[公开仓库](https://github.com/PNTAN17/neurogolf)、[5th Place Solution - Claudex](https://www.kaggle.com/competitions/neurogolf-2026/writeups/6th-place-solution-claudex)
- rank1：[Introduction](https://www.kaggle.com/competitions/neurogolf-2026/writeups/1st-place-kaggle-agent)、[Pipeline overview](https://www.kaggle.com/competitions/neurogolf-2026/discussion/726799)、[Self Evolving Prompts](https://www.kaggle.com/competitions/neurogolf-2026/discussion/726883)
