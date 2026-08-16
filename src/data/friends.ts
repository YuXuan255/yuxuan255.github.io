export interface Friend {
  name: string;
  url: string;
  description: string;
}

export const friends: Friend[] = [
  {
    name: "Controlvector",
    url: "https://www.controlvector.top/",
    description: "高中同学，现在在交大John班，很强很抽象。",
  },
  {
    name: "Mitchell",
    url: "https://broken.life/",
    description:
      "高中同学，ECNU计算机拔尖班，LLVM contributor & Clang-tidy maintainer，唯一真神。",
  },
];
