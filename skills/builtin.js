/* 内置技能库：每个技能就是一份 Markdown，可直接导出、修改、替换
 * 节点 id：analysis / script / artPrompts / assets / storyboard / shotPrompts / pack / final */
window.BUILTIN_SKILL_MD = [

`---
id: analysis-five-dim
name: 创意分析 · 五维拆解
node: analysis
kind: text
version: 1.0
order: 1
tags: 分析, 钩子, 受众, 视觉基调
---

## 说明
把一句话创意拆成主题、受众、反差钩子、核心信息与视觉基调五块，输出结构化 JSON，供剧本与美术节点直接消费。

## 系统提示词
你是重型装备品牌的内容策划。只输出 JSON，不要解释。所有参数只能引用给定事实，不得编造数值；涉及估算必须写明估算基准。

## 模板
创意原文：{{brief}}
风格：{{style}}
画幅：{{ratio}}
目标时长：{{duration}} 秒
镜数：{{sceneCount}}

请输出 JSON：
{"theme":"一句话主题","audience":"目标受众","hook":"前 3 秒的反差钩子","keyMessage":["关键信息，最多 3 条"],"visualStyle":"视觉基调","palette":["主色，最多 3 个"],"constraints":["必须遵守的限制"]}
`,

`---
id: analysis-contrast-first
name: 创意分析 · 反差优先
node: analysis
kind: text
version: 1.0
order: 2
tags: 反差, 名场面, 叙事角度
---

## 说明
先把创意压成一个不可能的场景，再落回真实产品参数。适合名场面穿越、跨时空对照类主题。

## 系统提示词
你是擅长反差叙事的短片策划。只输出 JSON。先写不可能的场景，再写真实依据，不得虚构数据。

## 模板
创意原文：{{brief}}
风格：{{style}}
画幅：{{ratio}}
目标时长：{{duration}} 秒
镜数：{{sceneCount}}

输出 JSON：
{"impossibleScene":"不可能的场景描述","realAnchor":"落回的真实依据","contrast":"反差落点一句话","theme":"主题","audience":"受众","visualStyle":"视觉基调","palette":["主色"],"constraints":["限制"]}
`,

`---
id: script-three-act
name: 剧本脚本 · 三段式
node: script
kind: text
version: 1.0
order: 1
tags: 剧本, 三段式, 字幕
---

## 说明
按起势、展开、收束三段写镜头级剧本，每场给出旁白、字幕与画面描述，场景数跟随参数。

## 系统提示词
你是广告片编剧。只输出 JSON。旁白口语化，单句不超过 18 字；字幕与旁白必须一致；不得出现未经证实的数据。

## 模板
创意分析：
{{analysis}}

参数：画幅 {{ratio}}，目标时长 {{duration}} 秒，场景 {{sceneCount}} 个，风格 {{style}}

输出 JSON：
{"title":"片名","logline":"一句话故事线","scenes":[{"id":"S01","act":"起势|展开|收束","title":"小标题","narration":"旁白","subtitle":"字幕","seconds":6,"visual":"画面描述"}],"claims":["片中出现的所有事实性表述"]}
`,

`---
id: script-proof-rhythm
name: 剧本脚本 · 卖点节奏
node: script
kind: text
version: 1.0
order: 2
tags: 剧本, 卖点, 节奏, 参数
---

## 说明
按“问题—对比—证据—结论”的节奏组织，每一场只承载一个卖点，适合产品科普与销售支持场景。

## 系统提示词
你是工业品科普编剧。只输出 JSON。每场只讲一个卖点，卖点必须有可核对的依据；没有依据的卖点直接删掉。

## 模板
创意分析：
{{analysis}}

参数：场景 {{sceneCount}} 个，总时长 {{duration}} 秒，画幅 {{ratio}}

输出 JSON：
{"title":"片名","logline":"一句话故事线","scenes":[{"id":"S01","act":"问题|对比|证据|结论","title":"卖点小标题","narration":"旁白","subtitle":"字幕","seconds":6,"visual":"画面描述","proof":"该场依据"}],"claims":[]}
`,

`---
id: art-cinematic
name: 美术提示词 · 电影感写实
node: artPrompts
kind: text
version: 1.0
order: 1
tags: 美术, 生图, 提示词, 负向
---

## 说明
把剧本场景翻译成可直接投喂生图模型的提示词，统一机位、光线、材质与负向词。

## 系统提示词
你是电影概念美术。只输出 JSON。提示词用英文书写，画面中不出现任何文字、标志、水印或字幕。

## 模板
剧本：
{{script}}

统一基调：{{style}}，画幅 {{ratio}}，电影级写实 CGI，体积光，尘雾颗粒。

输出 JSON：
{"style":"统一风格描述","negative":"text, letters, numbers, watermark, logo, brand mark, subtitle, UI","assets":[{"id":"A01","sceneId":"S01","prompt":"英文提示词","size":"1536x1024"}]}
`,

`---
id: assets-batch-sheet
name: 美术资产 · 批量任务单
node: assets
kind: image
version: 1.0
order: 1
tags: 生图, 批量, 重试, 落盘
---

## 说明
把美术提示词整理成批量任务单：每张图的文件名、尺寸、重试策略与落盘路径一次写清，失败只补单张。

## 系统提示词
你是资产生产调度。只输出 JSON。任务必须可逐个重跑，文件名与镜头编号一一对应。

## 模板
美术提示词：
{{artPrompts}}

输出 JSON：
{"concurrency":2,"timeoutSeconds":180,"retry":{"maxAttempts":2,"on":["timeout","rate_limit"]},"tasks":[{"assetId":"A01","file":"assets/A01.png","size":"1536x1024","prompt":"英文提示词"}]}
`,

`---
id: storyboard-grid
name: 拆解分镜 · 镜头表
node: storyboard
kind: text
version: 1.0
order: 1
tags: 分镜, 镜头表, 时长
---

## 说明
把剧本与美术资产对齐成镜头表：镜号、时长、机位、画面、字幕、对应资产，一次成表。

## 系统提示词
你是分镜师。只输出 JSON。镜头时长合计必须等于目标时长；每镜只能对应一张美术资产。

## 模板
剧本：
{{script}}

美术资产：
{{artPrompts}}

目标时长 {{duration}} 秒，镜数 {{sceneCount}}。

输出 JSON：
{"totalSeconds":{{duration}},"shots":[{"shot":"SH01","sceneId":"S01","assetId":"A01","seconds":9,"camera":"机位与运动","frame":"画面要点","subtitle":"字幕"}]}
`,

`---
id: shotprompt-shot-level
name: 每镜视频提示词 · 逐镜可拍
node: shotPrompts
kind: text
version: 1.0
order: 1
tags: 视频, 逐镜, 运镜
---

## 说明
把每镜分镜写成可提交的视频提示词：主体、动作、运镜、光线、时长、画幅，一镜一段。

## 系统提示词
你是短视频导演。只输出 JSON。每镜提示词独立成段，不含跨镜引用；不写文字与标志。

## 模板
分镜表：
{{storyboard}}

画幅 {{ratio}}，单镜时长以分镜为准。

输出 JSON：
{"shots":[{"shot":"SH01","seconds":9,"prompt":"主体 + 动作 + 运镜 + 光线 + 画幅","negative":"text, watermark, subtitle"}]}
`,

`---
id: pack-delivery
name: 视频任务包 · 交付包
node: pack
kind: pack
version: 1.0
order: 1
tags: 任务包, 交付, 复用
---

## 说明
把所有逐镜提示词与素材路径打包成可交付、可复用的任务包，附执行顺序与失败恢复策略。

## 系统提示词
你是交付负责人。只输出 JSON。任务包必须能脱离对话独立执行，缺项要显式标注。

## 模板
逐镜提示词：
{{shotPrompts}}

输出 JSON：
{"version":"1.0","ratio":"{{ratio}}","shots":[{"shot":"SH01","seconds":9,"prompt":"...","output":"videos/SH01.mp4"}],"recovery":{"retryFailedOnly":true,"reuseExisting":true},"missing":[]}
`,

`---
id: final-check
name: 最终成片 · 验收清单
node: final
kind: check
version: 1.0
order: 1
tags: 验收, 字幕, 时长, 事实
---

## 说明
成片出来后的统一验收清单：时长、字幕、画面、事实表述与声明，逐项打勾才可交付。

## 系统提示词
你是片审。只输出清单，逐项给出通过或不通过，并写明依据。

## 模板
成片信息：
{{pack}}

逐项核对：
1 总时长与镜头表合计是否一致
2 字幕与旁白是否逐句对应
3 画面中是否出现文字、标志或水印
4 事实性表述是否都有出处
5 片尾是否保留 AI 生成声明

输出：逐项写「通过」或「不通过 + 原因」。
`,

];
