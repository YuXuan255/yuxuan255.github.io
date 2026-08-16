---
title: "Orbit Wars Writeup:BC is all you need"
description: "Kaggle orbit wars比赛复盘，最终名次40/4729，银牌。"
date: 2026-08-16
tags:
  - kaggle
  - RL
  - BC
  - writeup
draft: false
featured: true
---

其实这个比赛很早就结束了，只是这个writeup拖了很久才写()

由于比赛项目仓库管理的不是很好，加上没有养成良好的记实验记录的习惯，导致最后复盘比较痛苦，丢了不少参数和细节，最后还是尝试让codex重新整理了一下整个代码库以及从最后的提交文件反推了一些内容，写了一份完整writeup，意外地发现他其实整理的还挺全的，每个模块基本上都涵盖了。

经过我个人的回忆，几个重要的节点大概如下：

- **从启发式转入BC**：我进team的时候[Controlvector](/friends/)已经基于开源代码改进得到了一个在当时看来质量还不错的策略，然而继续向上优化遇到了极大的困难。后来Controlvector尝试去直接蒸馏rank1的策略，发现即使是一个简陋的模型也已经展现出了巨大的潜力，于是我们直接放弃启发式路线开始BC。
- **解决head设计失误**：为了让模型训练快速跑起来，codex在一开始实现的时候对head进行了一些简化（然后后面忘记改了），在相当长的一段时间里这个很烂的head一直保留着，拖累了模型训练。
- **采用GNN层**：“Transformer 不是万能的，添加 GNN 层大大增加了模型能力，是一度冲上 rank 4 的关键。我相信这套网络的潜力很大，只是 RL 没训出来。”——by Controlvector
- **解决退火问题**：早期的退火没有正常触发，相当于不存在退火组件，我提出退火对loss的监测存在bug，当时Controlvector认为问题不大，不过后来证明退火还是有用的。
- **提出回放清洗策略**：注意到rank1的策略经常在大优势以后开始做无效动作，自然想到需要清洗用于BC的回放数据，提取出“更高质量”的回合用于学习。这大幅度提升了训练质量。
- **硬件升级**：感谢[Mitchell](/friends/)赞助的**A100 80GB**，帮助我们渡过难关。

一些探索过但是没有work的路线，以及一些局限：

- **尝试引入其他top player的回放数据进行训练**：我最早提出了这个设想并且它在早期work过很短的一段时间，当时本地的某版SOTA策略就是基于这个数据集训练的。然而由于rank1实在是太过于dominating，再加上我们后面采用的回放清洗策略进一步解决了rank1回放中存在的一些问题，提升了数据质量，这条路线就停了。
- **尝试PPO**：没有成功，训练一直难以推进，即使从BC的模型上尝试微调也难以带来稳定的收益。一个很复杂的问题。
- **四人局训练**：我们最后的终版策略虽然针对四人局做了额外训练，但是效果并不好，一方面系统本身四人局匹配的比例较少，导致能拿到的原始回放数据远少于二人局；一方面四人局又远远比二人局要复杂。最后我们没能做出一个很强的四人局模型。

以上主要是我个人的视角，并不保证全面。

总的来说我们并没有从零开始完整地训RL，而是比较取巧地通过BC的方式取得了较好的名次。如果你好奇到底是多强的模型能够让我们光靠BC就拿到整场比赛的40名，推荐阅读rank1 isaiahP的[writeup](https://www.kaggle.com/competitions/orbit-wars/writeups/1st-place-solution-scaling-reinforcement-learnin)，感受200M Transformer，15B self-play steps，2400 B200 hours带来的震撼。

这个比赛主要带队的是Controlvector，真正的天才，随口提出一个idea可能就work了。如果他一开始没有试着去蒸rank1我们可能要过好久才能意识到BC这个方法的潜力，在后续训练中他又提供了种种idea，不胜枚举；我则就是探索了一些路线、做了一些数据方面的work、发现了一些bug，其他时候被带飞；Mitchell在我们资源陷入紧张的时候慷慨地提供了硬件上的重要支持，并且协助跑了一些实验，是雪中送炭级别的。感谢队友们带飞我🙏。

后面的部分是codex生成的完整writeup，供参考。

---

## TL;DR

最终 agent 是一套按对局人数路由的双模型系统：2P 和 4P 分别训练、分别编码特征，但共享同一套“C++ 物理编码器 + 图网络 + Transformer + Top-K pointer head + NumPy 部署”的总体设计。

- 数据来自排行榜高分玩家的公开回放，只学习胜者动作。2P 最终使用 `Isaiah @ Tufa Labs` 的 2,113 场胜局，4P 使用 `TonyK` 的 503 场胜局。
- 数据不是简单逐帧照抄。每个状态先变换到当前玩家的 canonical perspective，再由物理引擎把连续的 `[source, angle, ships]` 映射成离散的“源星球—目标星球—发兵档位”标签。
- 为减少已经胜券在握后的低价值动作，使用基于船数优势置信度的截断：2P 从 1,002,060 行压到 284,563 行，4P 从 171,941 行压到 78,326 行。
- 模型先经过 8 层图消息传递，再经过 4 层、宽度 128 的 Transformer。动作头扫描己方兵力最多的 10 个星球，通过一个 64 维 autoregressive decoder 协调多次发兵。
- 连续动作空间被强归纳偏置约束：网络选择目标和 14 档发兵量，C++ 求解器负责计算移动目标的拦截角度，并 mask 掉无法命中或无法支付的动作。
- 仓库实现了 PPO、GAE、value head、self-play league、frozen snapshots、KL/clip fraction/EV 等完整基础设施，也确实以 BC checkpoint 作为 PPO 初始化格式；但最终两个权重的元数据均为 `behavior_cloning=winner_replay`、`update=0`。因此最终提交应准确描述为 **BC 模型，而不是 PPO fine-tuned 模型**。

## 1. 问题与主要难点

[Orbit Wars](https://www.kaggle.com/competitions/orbit-wars) 是一个同时支持 2P 和 4P 的连续空间即时策略游戏。玩家在 100×100 的地图上占领星球、积累产能并发射舰队；部分星球绕中心太阳旋转，彗星会沿椭圆轨迹进入和离开地图，舰队则以与规模相关的速度直线飞行。每局最多 500 回合，最终按星球和在途舰队中的总船数判定胜负。

对学习型 agent 来说，困难主要来自四点：

1. 状态是变长实体集合，而不是固定图像或短向量；星球、移动星球、彗星和大量在途舰队同时存在。
2. 动作原本近似连续：需要选择源星球、角度和整数船数，且移动目标的正确角度依赖未来位置。
3. 回报延迟很长。一次发兵可能几十回合后才落地，其价值又取决于到达前的产能、其他舰队和多人混战。
4. 2P 与 4P 的策略分布不同。4P 不能只把三个对手合并成一个“enemy”；对手身份、夹击和第三方获利都会改变最优动作。

方案的核心不是让网络从原始 JSON 中同时学会物理、几何、动作合法性和战略，而是先用 C++ 把物理约束和有用的归纳偏置编码好，再把有限的模型容量用在决策上。

## 2. 总体方案

```text
Kaggle 高分回放
    │
    ├─ 按 replay 构建可复用 shards
    ├─ canonical perspective + C++ 物理编码/动作标注
    ├─ 胜者过滤 + 优势阶段截断
    └─ float16 memmap 数据集
             │
             ▼
      8× Graph Block
             │
      4× Transformer Block
             │
      Top-10 rank-scan action head
             │
      BC + 对局胜率选择 checkpoint
             │
             ▼
   2P / 4P NPZ + C++ .so + NumPy inference
```

最终包中的两个模型参数如下。参数量由 NPZ 内 278 个 float32 参数数组直接统计得到。

| 项目                             |               2P |               4P |
| -------------------------------- | ---------------: | ---------------: |
| 参数量                           |        3,858,492 |        3,949,268 |
| 权重文件大小                     | 15,564,366 bytes | 15,931,010 bytes |
| Observation schema               |               v3 |               v4 |
| Observation 维度                 |            2,066 |            3,825 |
| Global / planet / event features |      18 / 24 / 4 |     49 / 29 / 15 |
| Graph blocks                     |                8 |                8 |
| Transformer blocks               |                4 |                4 |
| `d_model` / heads / MLP          |    128 / 4 / 256 |    128 / 4 / 256 |
| Top-K sources / 最大动作槽       |          10 / 10 |          10 / 10 |
| 发兵档位                         |               14 |               14 |
| History features                 |             关闭 |             关闭 |

## 3. C++ 环境、canonical perspective 与物理动作层

### 3.1 为什么重写环境

官方环境适合验证和生成地图，但大规模数据编码与 RL rollout 需要更高吞吐。项目将逐回合模拟、内置对手、特征编码、动作 mask、动作解码和奖励逻辑放进了 C++，Python 只负责训练编排和必要的胶水。

训练时仍可使用 Kaggle 的地图生成器初始化地图；进入逐步模拟后，主要计算均由批量 C++ simulator 完成。项目背景说明 C++ 引擎已与官方环境对齐，但当前仓库没有保留完整 parity 报告或逐帧测试产物，因此这里不提供未经留档的误差数字。

### 3.2 一个模型覆盖所有座位

每次为某个玩家编码状态时，会先把该玩家映射为 canonical player 0，并根据初始 home planet 旋转整个地图。星球随后按“旋转后的初始 x、初始 y、id”稳定排序；owner、舰队角度、彗星路径和历史状态同步变换。

这样做有三个好处：

- 同一套权重可以用于任意座位；
- 旋转对称地图上的等价局面获得一致表示；
- 星球在运动、彗星加入或对象内部顺序变化时，slot 仍尽量稳定。

最终提交入口还专门修补了 step 0 的初始 home owner/ships，并在 observation 缺失 `step` 时维护合成计数，避免训练与 Kaggle 推理输入的细节差异破坏特征。

### 3.3 把连续动作改造成结构化离散动作

网络不直接回归角度。对于每个源—目标星球对，C++ 会计算：

- 在剩余回合内是否存在能命中目标的发射角；
- 考虑目标旋转、彗星运动、太阳和碰撞后的预计到达时间；
- 每个发兵档位是否负担得起、是否合法；
- 中立星球是否至少能被相应兵力攻占。

因此模型看到三类额外输入：

- `pair_mask`：合法的 source-target pair；
- `pair_eta`：pair 的预计到达时间；
- `pair_fraction_mask`：该 pair 下合法的发兵档位。

模型输出离散动作后，C++ 再求解真实发射角和船数。这一步显著缩小了策略搜索空间，也保证了最终动作与训练标签使用同一套物理语义。

14 个发兵档位由两类动作组成：

- 当前驻军比例：`10%, 15%, 20%, 25%, 33%, 40%, 50%, 60%, 75%, 100%`；
- 预计攻占成本的倍数：`1.00×, 1.15×, 1.35×, 1.75×`。

攻占成本会考虑已经飞向目标的舰队。与纯比例 head 相比，这让模型可以直接表达“刚好拿下”或“为不确定性留 buffer”。

## 4. 状态表示与特征工程

### 4.1 Global features

Global token 汇总回合进度、星球数、敌我总产能、总船数、驻守船数、中立资源、星球/产能/船数差、角速度和终局进度等信息。

4P 不仅保留“我 vs. 其余玩家”的总览，还按 canonical owner 顺序为三个对手分别编码产能和船数。v4 schema 另外为关键船数同时提供 log、`/100` 和 `/1000` 三种尺度，减轻单一 log 表示对局部兵力差不敏感的问题。

### 4.2 Planet features

最多保留 64 个 planet/comet slots。每个星球的主要信息包括：

- 所有权、坐标、半径、驻军、产能；
- 是否彗星、是否轨道星球、相位、切向速度和有效角速度；
- 当前驻军对应的发射速度；
- 彗星剩余寿命与轨迹进度；
- 未来 50 回合的轨道漂移强度；
- 剩余回合可创造的产能价值和潜在终局 swing。

4P 再增加三个独立的 opponent-owner indicator。最终模型没有启用短窗口 history features，决策依赖当前状态和在途舰队的未来事件编码。

### 4.3 不给每支舰队单独做 token

舰队数可能很大，逐舰队 self-attention 会增加训练与推理成本，也给对手通过制造大量小舰队拖慢 agent 的机会。最终 schema 改为最多 128 条“到达事件”：

- 2P 每条事件记录 `valid, target, ETA, signed ships`；
- 4P 分别记录自己和三个对手在该 target/ETA 的船数，并提供多尺度数值。

模型按目标星球和多组 ETA 前缀桶聚合这些事件，同时保留最近到达时间和最近一批船数，再投影并加到对应 planet token。于是网络看到的是“未来哪些时间点、哪些阵营会给这个星球带来多少净兵力”，而不是一堆难以组合的原始舰队坐标。

## 5. 模型架构

### 5.1 Graph trunk + Transformer

Global 和 planet features 先投影到 128 维。未来到达事件经上述 bucket projection 注入 planet token 后，主干依次执行：

1. **8 个 OrbitGraphBlock**：在所有 planet pair 间计算有向消息，利用 ETA edge bias 聚合 incoming/outgoing context，并回写 global 与 planet 表示；
2. **4 个 pre-LN TransformerBlock**：4-head self-attention + 256 维 GELU MLP；
3. 最终 LayerNorm，得到 global embedding 和每个 planet embedding。

最终四个 Transformer block 本身没有启用直接 ETA attention bias；几何与到达时间主要通过 graph blocks、pair scalar features 和动作 head 进入模型。

### 5.2 Top-K rank-scan pointer head

并非所有星球都值得作为 source。模型先从己方星球中按驻军降序选出 Top 10，然后固定为 10 个 source-rank slots。每个 slot 做三件事：

1. 在 `no-op` 与“从该 source 发射”之间选择；
2. 若发射，用 pointer score 在所有合法 target 中选择一个；
3. 在合法的 14 个发兵档位中选择船数。

Target score 同时使用 source/target embedding 的点积、pair ETA、相对坐标、距离、源/目标标量特征、source/target bias 和 slot bias。

一个 64 维 autoregressive decoder state 顺序读取已经决定的 source、target 和 fraction，再影响后续 slot 的 target、no-op 和 fraction logits。因此它既保留“一次前向得到 planet 表示”的效率，也允许不同 source 的动作发生一定程度的协调。

模型还包含 value head，目的是让同一 checkpoint 能继续进行 PPO；但 BC loss 不训练 value head，最终 greedy inference 也不使用它。

## 6. 回放数据与数据工程

### 6.1 回放采集

仓库中的工具支持从当前 leaderboard top-N submission 拉取公开 episodes，也支持从批量 replay archive 中按队名筛选。回放按 2P/4P 分目录保存，并记录 team、seat、reward、seed 和 episode id。

BC 只保留正 reward 的最高分玩家，随后逐回合提取该胜者的 observation 和 action。连续角度不是简单取最近星球：标签生成器使用相同的 C++ 轨迹逻辑，反推出舰队真正会命中的 target，再把实际船数映射到最接近且合法的 fraction/capture-cost 档位。

最终数据统计如下：

| 项目               |                 2P |      4P |
| ------------------ | -----------------: | ------: |
| 输入 replay files  |              2,785 |     503 |
| 实际胜者 replay    |              2,113 |     503 |
| 主要胜者           | Isaiah @ Tufa Labs |   TonyK |
| 截断前状态数       |          1,002,060 | 171,941 |
| 最终状态数         |            284,563 |  78,326 |
| 含发兵状态数       |            165,188 |  38,375 |
| 总发兵标签数       |            248,017 |  61,660 |
| 每状态平均发兵数   |              0.872 |   0.787 |
| 无效动作跳过       |                  0 |     249 |
| 非法 fraction 调整 |                  0 |     328 |

2P 开启了 team-only player filtering：2,785 个候选 replay 中，有 672 个胜者不是目标队伍而被过滤。4P 全部 503 个 replay 的胜者均为 `TonyK`；其中包含 `Isaiah @ Tufa Labs` 的 55 场对局被整体赋予 2× sample weight，共影响 9,853 行。

### 6.2 去掉“胜利垃圾时间”

只学习胜者仍有一个问题：当优势已经不可逆，胜者后续可能随意屯兵、刷小舰队或做与获胜无关的动作。项目定义了一个基于敌我总船数的 confidence score：

$$
C = \log\frac{S_{me}+100}{S_{enemy}+100}
  + 0.5\log\left(1 + \frac{\max(S_{me}-S_{enemy},0)}{1000}\right)
$$

当某局第一次满足 `C >= 1.0` 时，从触发状态开始丢弃该胜者后续所有样本。该规则在 2P 丢弃 717,497 行（71.60%），在 4P 丢弃 93,615 行（54.45%）。这是最终数据规模变化最大的单项处理。

### 6.3 Shards、memmap 与切分

每个 replay 先编码成独立 NPZ shard，并带 schema digest 和源文件签名；之后再合并为持久化 memmap。observation 和 pair ETA 以 float16 保存，训练时按块 shuffle，避免反复解析大型 JSON 和重复运行物理编码。

训练/验证不是随机切状态，而是先按 replay id 切分，再展开成 row indices，避免同一局的相邻状态同时出现在训练集和验证集。

## 7. Behavior Cloning

### 7.1 目标函数

Rank-scan head 在每个 source slot 上使用：

- launch/no-op cross entropy；
- 发射时的 target cross entropy；
- 发射时的 fraction cross entropy。

总 loss 是 pair loss 与 fraction loss 之和。代码默认将高频 no-op 的 loss weight 降到 0.2，以防模型仅靠预测“不行动”获得很高的表面准确率。

Autoregressive decoder 在训练时读取 expert prefix，部署时读取自身已选动作，因此仍存在典型的 teacher-forcing exposure gap。最终选择模型时没有只看 imitation loss，而是周期性让 checkpoint 真正对局，并按 battle validation win rate 保存 best state。

### 7.2 最终训练配置

| 项目                             |              2P |                                          4P |
| -------------------------------- | --------------: | ------------------------------------------: |
| 最终 BC epoch                    |              20 |                                          35 |
| 初始 learning rate               |            5e-4 |                                        5e-5 |
| 最终 learning rate               |       1.5625e-5 |                                        1e-6 |
| LR 监控                          | validation loss |                             validation loss |
| LR factor / patience / min delta | 0.5 / 2 / 0.005 |                             0.5 / 2 / 0.005 |
| Trunk dropout                    |            0.06 |                                        0.05 |
| Head dropout                     |               0 |                                           0 |
| Weight decay                     |            1e-4 |                                        2e-4 |
| Gradient norm clip               |             1.0 |                                         1.0 |
| 初始化                           |      随机初始化 | 从 `bc_graph_4p_v2` 恢复全部 278 个参数数组 |

训练运行于 JAX GPU；元数据只保留了 `gpu:0 cuda:0`，没有硬件型号、batch size、wall time 或完整命令。代码默认 batch size 为 1,024、validation fraction 为 15%，但由于最终 sidecar 未嵌入这两个字段，不能将默认值当作已确认的最终配置。

### 7.3 Imitation metrics

| 指标                        |              2P |              4P |
| --------------------------- | --------------: | --------------: |
| Train / valid loss          | 0.3151 / 0.4401 | 0.7471 / 0.8921 |
| Valid pair accuracy         |          93.76% |          89.69% |
| Valid exact launch accuracy |          63.05% |          38.74% |
| Valid action-set accuracy   |          53.72% |          37.27% |
| Valid action-set F1         |          65.38% |          49.41% |
| Expert valid no-op rate     |          91.28% |          90.28% |
| Predicted valid no-op rate  |          89.46% |          88.10% |

Pair accuracy 很高，但每个 source slot 约九成是 no-op，因此它并不是最可靠的质量指标。Exact launch、action-set F1 和真实对局胜率更能反映策略是否学会了“何时从哪里打向哪里、发送多少”。4P 数据更少、目标分布也更复杂，其 imitation 指标明显弱于 2P。

## 8. PPO：实现完成，但没有进入最终权重

仓库中的 PPO 路径不是占位代码。现存实现包括：

- C++ batch rollout 与 JAX policy/value forward；
- GAE、clipped policy/value objective、entropy bonus 和 gradient clipping；
- `terminal_winloss` 及多种 ship-margin shaping reward；
- BC anchor KL、按目标发兵数正则、adaptive KL learning rate；
- explained variance、approx KL、clip fraction、pair/fraction entropy；
- fixed opponents、checkpoint opponents、frozen self-play snapshots 和动态 league 权重；
- 独立的 validation seeds、异步验证与 best-checkpoint 保存；
- 仅训练 value head 的诊断模式。

最终提交包给出了更直接的判断依据：

- 2P：`update=0`，`behavior_cloning=winner_replay`；
- 4P：`update=0`，`behavior_cloning=winner_replay`。

因此可以确认的是：PPO 基础设施和继续训练路径存在，PPO 也属于项目尝试方向；不能确认的是具体跑过哪些配置、训练了多少 steps、为什么没有超过 BC。

## 9. 本地模型选择

最终 checkpoint 不是按最低 BC validation loss 选择，而是按固定对手的 battle validation win rate 选择：

| 模型 | 验证对手  | Episodes |    W / T / L | Win rate | 备注                                  |
| ---- | --------- | -------: | -----------: | -------: | ------------------------------------- |
| 2P   | `epoch11` |      128 | 110 / 0 / 18 |   85.94% | 仅 candidate-first，seed salt 70000   |
| 4P   | 3× `v1`   |      128 | 111 / 0 / 17 |   86.72% | first-place 计为 win，seed salt 70000 |

## 10. 部署

最终提交包同时包含：

- 根目录 `main.py`；
- 预编译的 C++ simulator/encoder `.so`；
- 与 `.so` 对应的 C++ source；
- 轻量 Python runtime；
- 2P 与 4P 的 float32 NPZ 权重。

训练使用 Flax/JAX，部署则把参数导出为 NPZ，由手写 NumPy forward 完成推理，从而避免在 Kaggle agent 内启动 JAX/XLA。C++ 负责 observation import、canonical encoding、物理 mask 和动作解码。

其他部署细节包括：

- policy、simulator 和短历史缓存只初始化一次；
- BLAS/OpenMP 线程限制为 1，避免小矩阵推理发生线程过度订阅；
- 兼容 Kaggle 下不同工作目录和缺失 `__file__` 的加载方式；
- 打包阶段 smoke test 同时检查 2P、4P、缺失 `step` 和动态库加载；
- agent 顶层捕获异常并返回 `[]`，用保守 no-op 代替整局报错。

$$
$$
