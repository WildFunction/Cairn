import type { Slide } from '@cairn/core/types';

/**
 * Every layout at its worst, for looking at.
 *
 * Overflow is a property of real layout and no test lays anything out, so it is
 * checked by eye against content chosen to break things — the original bug
 * shipped because nobody had tried a value longer than "32华氏度". A new way to
 * overflow goes in here first.
 */
export const GAUNTLET: readonly { readonly what: string; readonly slide: Slide }[] = [
  {
    what: 'title —— 长标题撞站号水印，长副标挤压版心，kicker 撑破药丸',
    slide: {
      layout: 'title',
      kicker: '第三阶段 · 关于复利与临界点的一次长距离讨论',
      title: '微小积累与临界突破：为什么百分之一的改进在很久之后才被看见',
      subtitle: '短期不明显，不等于长期无效。这一站要把两条曲线的差别讲清楚，'
        + '并且说明为什么大多数人会在交叉点之前就放弃。',
      icon: 'seedling',
    },
  },
  {
    what: 'title —— 另一极端：只有标题，没有任何可依附的次要信息',
    slide: { layout: 'title', title: '起点' },
  },
  {
    what: 'points —— 三条长短悬殊的论断，检验它们是否被统一到同一档字号',
    slide: {
      layout: 'points',
      heading: '三条论断，长度差得很远，但它们的分量是一样的',
      points: [
        '短的一条',
        '中等长度的一条，大约到这里就该换行了吧',
        '最长的一条：如果把每天的改进折算成年化，百分之一的日改进在一年之后是三十七倍，'
        + '而百分之一的日退步在一年之后只剩下百分之三，这个差距不是线性的',
      ],
    },
  },
  {
    what: 'number —— 混单位（不该画条形）+ 超长数值 + 长标签',
    slide: {
      layout: 'number',
      heading: '不可比的一组：百分比与温度',
      items: [
        { value: '1%', label: '各个骑行环节的持续改进' },
        { value: '32华氏度', label: '冰块开始融化的临界点，也是这一节的隐喻来源' },
      ],
      note: '短期不明显，不等于长期无效',
    },
  },
  {
    what: 'number —— 可比但数值极长，且含零：条形该画，字号该降',
    slide: {
      layout: 'number',
      items: [
        { value: '0 人', label: '第一年' },
        { value: '1,250,000 人', label: '第十年' },
        { value: '3 万人', label: '第五年' },
      ],
    },
  },
  {
    what: 'quote —— 长引文撞引号水印与字幕带；且无出处，须显示未溯源',
    slide: {
      layout: 'quote',
      text: '我们总是高估自己在一天里能做到的事，低估自己在一年里能做到的事；'
        + '因为前者是加法而后者是乘法，而人对乘法的直觉几乎为零，'
        + '这就是为什么复利被称作世界第八大奇迹。',
      cite: '《原子习惯》第一章 · 关于微小改变的累积效应',
    },
  },
  {
    what: 'compare —— 两栏内容长度极不对称，检验它们是否同档且不互相挤压',
    slide: {
      layout: 'compare',
      heading: '两种做法',
      left: { title: '目标导向', points: ['设定终点'], icon: 'target' },
      right: {
        title: '系统导向的持续改进方法',
        points: [
          '关注每天重复的那件事，而不是关注那个遥远的结果',
          '把环境设计成让正确的行为成为阻力最小的选择',
          '允许失败一次，但绝不允许失败两次',
        ],
        icon: 'cycle',
      },
    },
  },
  {
    what: 'timeline —— 六条，mark 长短悬殊，最后一条正文很长',
    slide: {
      layout: 'timeline',
      heading: '一个习惯从建立到稳定',
      items: [
        { mark: '第 1 天', text: '决定开始' },
        { mark: '第 2 周', text: '新鲜感耗尽，这是第一个放弃高峰' },
        { mark: '1985', text: '一个和上面完全不同量级的 mark' },
        { mark: '第 66 天', text: '平均而言行为开始自动化' },
        { mark: '', text: '没有 mark 的一条，看它会不会把整条线拽歪' },
        {
          mark: '第 2 年',
          text: '此时它已经不再是一个需要意志力维持的习惯，而是身份的一部分；'
            + '你不再是"在跑步的人"，你就是跑者，这个转变才是全部意义所在',
        },
      ],
    },
  },
  {
    what: 'matrix —— 四行，左右两列长度极不对称，维度名很长',
    slide: {
      layout: 'matrix',
      heading: '两种做法逐项对照',
      left: '目标导向',
      right: '系统导向',
      rows: [
        { aspect: '关注点', left: '终点', right: '每天重复的那件事' },
        {
          aspect: '达成之后会发生什么',
          left: '动力消失，因为那个曾经拉着你的东西已经不在了',
          right: '继续',
        },
        { aspect: '失败时', left: '推倒重来', right: '只是漏了一次' },
        { aspect: '身份', left: '不变', right: '被一次次的小行为重新定义' },
      ],
    },
  },
  {
    what: 'relation —— 四条因果，节点名长短悬殊，关系词长',
    slide: {
      layout: 'relation',
      heading: '这条链上每一步都是书里明说的',
      links: [
        { from: '提示', how: '触发', to: '渴望' },
        { from: '环境设计', how: '降低阻力从而提高', to: '行为发生的概率' },
        { from: '连续失败两次', how: '导致', to: '习惯中断' },
        { from: '身份认同', how: '反过来强化', to: '行为' },
      ],
    },
  },
  {
    what: 'flow —— 五步，其中一步长到会把节点撑成两行',
    slide: {
      layout: 'flow',
      heading: '一次改进是怎么变成习惯的',
      steps: [
        '提示',
        '渴望',
        '把行为拆到小得不可能失败的程度，比如只做两分钟',
        '反应',
        '奖赏',
      ],
    },
  },
  {
    what: 'relation —— 有焦点、带旁注：只有一条的结果被强调，旁注在图下右对齐',
    slide: {
      layout: 'relation',
      heading: '只有一条链是这一站要讲的',
      links: [
        { from: '提示', how: '触发', to: '渴望' },
        { from: '环境设计', how: '降低阻力从而提高', to: '行为发生的概率' },
        { from: '身份认同', how: '反过来强化', to: '行为' },
      ],
      focus: 1,
      aside: '每一次行动都是在为你想成为的那种人投票，而这一票比你想象的更有分量，也更难撤回',
    },
  },
  {
    what: 'matrix —— 四行加旁注，检验旁注会不会把表格挤进字幕带',
    slide: {
      layout: 'matrix',
      left: '目标导向',
      right: '系统导向',
      rows: [
        { aspect: '关注点', left: '终点', right: '每天重复的那件事' },
        { aspect: '达成之后会发生什么', left: '动力消失，因为那个曾经拉着你的东西已经不在了', right: '继续' },
        { aspect: '失败时', left: '推倒重来', right: '只是漏了一次' },
        { aspect: '身份', left: '不变', right: '被一次次的小行为重新定义' },
      ],
      aside: '赢家和输家的目标是一样的',
    },
  },
  {
    what: 'cycle —— 六步，其中一步长到降档，带焦点和旁注',
    slide: {
      layout: 'cycle',
      heading: '一个自我强化的回路：最后一步回到第一步',
      steps: ['提示', '渴望', '反应越来越自动化并且不再需要意志力', '奖赏', '身份认同', '更多提示'],
      focus: 2,
      aside: '习惯是自我提升的复利',
    },
  },
  {
    what: 'cycle —— 最少的三步，环不该显得空',
    slide: { layout: 'cycle', steps: ['焦虑', '拖延', '更焦虑'] },
  },
  {
    what: 'pyramid —— 五层，最长一层到上限，顶层为焦点，带旁注',
    slide: {
      layout: 'pyramid',
      heading: '需求层次：越往上越稀少',
      levels: [
        '自我实现',
        '尊重：来自他人的认可，以及对自己能力的确信，二者缺一不可而且互相强化，也互相削弱',
        '归属与爱',
        '安全',
        '生理需求',
      ],
      focus: 0,
      aside: '人是一种不断有所需求的动物',
    },
  },
  {
    what: 'quadrant —— 格名与说明都到上限，轴两端很长，有焦点和旁注',
    slide: {
      layout: 'quadrant',
      heading: '紧急与重要：两个维度交叉出四种事',
      x: { low: '并不怎么紧急的那些事', high: '紧急的事情' },
      y: { low: '并不怎么重要的那些事', high: '真正重要的那些事情' },
      cells: [
        { name: '计划去做：长期投入与自我提升，以及所有真正要紧的事', text: '最容易被推迟，也最决定长期结果；应当为它预留固定的时间段，而不是等有空再说，更不是等到它终于变得紧急、再也拖不下去的那一天' },
        { name: '立即去做', text: '危机、截止日期、真正的紧急事件' },
        { name: '尽量授权给别人', text: '看起来紧急，其实只是别人的优先级落到了你身上' },
        { name: '删除', text: '消磨时间的事' },
      ],
      focus: 0,
      aside: '重要的事很少紧急，紧急的事很少重要',
    },
  },
  {
    what: 'overlap —— 三个集合，名字都长，交集名字到上限，带旁注',
    slide: {
      layout: 'overlap',
      heading: '三者相交之处',
      sets: ['你真正热爱并且愿意长期投入、即使没有回报也会去做的事', '你擅长的事', '世界愿意为之付钱并且会持续需要的事情'],
      meet: '可以持续一辈子、让人愿意每天醒来的天职与使命',
      aside: '找到三者的交点，工作就不再只是工作',
    },
  },
  {
    what: 'overlap —— 两个集合，最常见的形态',
    slide: { layout: 'overlap', sets: ['能力', '动机'], meet: '行为' },
  },
  {
    what: 'causes —— 四组各三条，组名与成因到上限，结果很长，有焦点和旁注',
    slide: {
      layout: 'causes',
      heading: '习惯为什么会中断',
      effect: '一个已经坚持了好几个月、几乎成了自动反应的习惯在某一周突然中断',
      groups: [
        { name: '环境：原来的提示变得完全不可见了', causes: ['搬家之后原来的所有提示都在一夜之间全部消失了', '出差', '手机放在床头'] },
        { name: '身份', causes: ['仍然把自己当作一个在尝试的人', '目标导向', '只在乎结果'] },
        { name: '难度', causes: ['一开始就定得太高', '没有两分钟版本', '把状态差的日子当作失败'] },
        { name: '奖赏', causes: ['好处太远', '没有即时反馈', '努力无人看见'] },
      ],
      focus: 1,
      aside: '错过一次是意外，错过两次就是一个新习惯的开始；真正要避免的从来不是失败本身，而是连续失败',
    },
  },
  {
    what: 'causes —— 最少的两组，各一条',
    slide: {
      layout: 'causes',
      effect: '中断',
      groups: [{ name: '环境', causes: ['看不见'] }, { name: '身份', causes: ['不认同'] }],
    },
  },
  {
    what: 'causes —— 两组各三条，组名与成因到上限，带标题和旁注',
    slide: {
      layout: 'causes',
      heading: '为什么已经形成的习惯仍会中断',
      effect: '一个坚持了数月的习惯突然中断',
      groups: [
        { name: '环境提示消失', causes: ['搬家后看不见提示', '出差打断原有节奏', '物品不在固定位置'] },
        { name: '身份认同不足', causes: ['仍把自己当作新人', '只在乎眼前的结果', '一次失误就想放弃'] },
      ],
      focus: 0,
      aside: '真正要避免的不是失败，而是连续失败',
    },
  },
];
