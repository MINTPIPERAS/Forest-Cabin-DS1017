/**
 * 所有界面文案的唯一来源。
 * 想改标题、标语、天气描述，只改这个文件即可，不用动 HTML 或渲染代码。
 */
export const COPY = {
  // 浏览器标签页标题
  siteTitle: '林间木屋 · Mistwood Cabin',

  // 左上角品牌
  brandName: 'PIPERAS-MISTWOOD',
  brandSub: '湖畔灯舍 · Nº 09',

  // 主标题（会拆成两段，后半段用暖色强调）
  heroTitleMain: '森中',
  heroTitleAccent: '灯影',

  // 主标题上方的小字
  eyebrow: 'A quieter kind of evening',

  // 主标题下方随光线变化的一句话
  taglines: {
    day: '日光落在湖面，松影在水里缓缓移动。',
    dusk: '暮色漫过松针，木屋里煨着一盏黄昏。',
    night: '夜色落满松林，木屋里还留着一盏灯。',
  },

  // 右上角时间
  times: {
    day: '10:24',
    dusk: '18:42',
    night: '23:16',
  },

  // 右上角天气与温度（按 天气 × 光线 组合）
  weatherLabels: {
    clear: {
      day: '晴 · 微风 · 18°C',
      dusk: '薄雾 · 西南风 2 级 · 7°C',
      night: '星夜 · 无风 · 4°C',
    },
    rain: {
      day: '小雨 · 风 3 级 · 14°C',
      dusk: '细雨 · 风 3 级 · 6°C',
      night: '夜雨 · 风 2 级 · 3°C',
    },
    snow: {
      day: '小雪 · 风 2 级 · -2°C',
      dusk: '落雪 · 风 1 级 · -5°C',
      night: '夜雪 · 无风 · -8°C',
    },
  },

  // 操作提示（桌面 / 触屏）
  hints: {
    orbitDesktop: '拖动环视',
    orbitTouch: '滑动环视',
    zoomDesktop: '滚轮靠近',
    zoomTouch: '双指缩放',
  },

  // 右侧竖排章节
  chapterNumber: '01',
  chapterLabel: 'THE CABIN',

  // 底部坐标
  coordinates: ['48° 12′ N', '121° 47′ E'],

  // 加载页
  loaderKicker: 'MISTWOOD · Nº 09',
  loaderTitle: '林深见灯',
  loaderStatus: '正在穿过雾林，点亮灯火…',
  loaderFoot: 'A FILM-LIKE FOREST STUDY · BEST WITH SOUND',

  // 沉浸模式提示
  immersiveHint: '退出沉浸模式',

  // 按钮 tooltip
  tooltips: {
    soundOn: '环境声 · 开',
    soundOff: '环境声 · 关',
    immersive: '沉浸看景 · H',
    immersiveExit: '退出沉浸 · H',
    fullscreen: '全屏',
    fullscreenExit: '退出全屏',
  },
};
