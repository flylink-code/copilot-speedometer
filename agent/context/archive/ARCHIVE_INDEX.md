# 归档索引

> **会话开始、以及接手「看起来做过」的任务时，先读这张表。**
> 规则见 `agent/rules/60-archive.md`。归档 ≠ 删除；归档卡里必须有「不要再做」与「失效条件」。

| 主题 | 结论一句话 | 状态 | 失效条件 | 详情 |
| --- | --- | --- | --- | --- |
| Marketplace 介绍图只显示 dashboard/settings | 打包时 `--no-rewrite-relative-links` 保留了相对路径；去掉该 flag，让 vsce 改写成 GitHub raw 绝对地址 | resolved | 仓库转私有 / 更换图片托管 | `HANDOFF.md` §8 坑 2 |
| VS Code 同时存在两个扩展目录 | 症状是“只有 t/s 没有数据”；删旧目录 + Reload Window 解决 | resolved | 扩展安装目录命名规则改变 | `HANDOFF.md` §8 坑 1 |
| 早期“decode rate 永远不可用” | 当时 569 条 BYOK 记录 `duration−TTFT` 中位数 18 ms；**现已部分失效**，Claude Sonnet 5.5 等有真实 TTFT 与 decode rate | superseded | 出现流式 BYOK 记录（已发生，**不要再当现状引用**） | `HANDOFF.md` §3 |
| 深回填只返回浅层数据 | 目录缓存 key 未含 `backfillDays`，已修复并加测试 | resolved | 目录缓存实现重写 | `HANDOFF.md` §4、`CHANGELOG.md` 0.2.2 |
| 0.3.1 及更早的版本演进 | 面板设置、诊断、i18n、自动隐藏均已交付 | archived | 版本号不再对应当前代码 | `CHANGELOG.md` |

## 状态

| status | 含义 | 可否当现状 |
| --- | --- | --- |
| `archived` | 已归档 | 否，仅历史背景 |
| `resolved` | 已解决但仍在活跃区 | 可以，先看复验条件 |
| `superseded` | 被取代 | 否，读 `superseded_by` |
| `workaround` | 只绕过未修根因 | 否，且**不得**标为已修复 |

## 使用方式

1. 用任务关键词搜本表 + `archive/` 目录文件名。
2. 命中 → 读归档卡的「结论」与「不要再做」。
3. 确实要重做（环境变了）→ 在归档卡追加「重新开启 + 原因」，**不要**删历史。
