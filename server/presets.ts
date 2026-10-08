import type { Prompt } from '../shared/types.js';

export const PRESETS: Prompt[] = [
 {
  id: 'model-release-dates',
  name: '模型发布日期',
  category: '知识与格式',
  description: '凭记忆回答发布日期，遵循日期与中文引号格式',
  system: '',
  text: `不联网搜索，凭记忆列出下列模型的发布日期：
Claude Sonnet 3.5
Claude Sonnet 3.7
Claude Opus 4.1
Claude Opus 4.5
格式要求：回答格式为“yyyy-mm-dd”，
使用中文引号“”而非英文引号""包裹`,
  version: 2,
  builtin: true,
 },
 {
  id: 'candy-guarantee',
  name: '糖果最少取出数',
  category: '逻辑推理',
  description: '不同形状的苹果味与桃子味糖果的保证问题',
  system: '',
  text: `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）
苹果味 桃子味 西瓜味
圆形 7 9 8
五角星形 7 6 4`,
  version: 1,
  builtin: true,
 },
 {
  id: 'pelican-bicycle',
  name: '鹈鹕骑自行车动画',
  category: 'HTML / SVG',
  description: '生成用 SVG 绘制二维动画的 HTML',
  system: '',
  text: '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试。',
  version: 1,
  builtin: true,
 },
];
