<div align="center">

# browser-agent-mcp

**高能力模型负责研判，低成本模型负责浏览器内执行**

</div>

`browser-agent-mcp` 是连接 Claude、GPT 等上层模型与 [browser-agent](https://github.com/zhang-pre/browser-agent) 内置 Agent 的 MCP 服务。它把任务拆成两个角色：director 制定路线并审核阶段成果，worker 在浏览器中完成抓包、签名追踪、环境补全和脚本验证。

这种分工把强模型的推理成本集中在关键决策处。默认的 `assist` 模式会在阶段门暂停并提交可审查结果，方便及时纠偏；路线明确后也可切换至 `auto`，让 worker 连续处理剩余工作。

---

## 导航

[协作机制](#协作机制) · [执行流程](#执行流程) · [架构](#架构) · [安装准备](#安装准备) · [快速委派](#快速委派) · [工具说明](#工具说明)

## 协作机制

一次任务按“下达目标—执行—审阅—校正”循环推进：

1. director 通过 `agent_start` 创建任务，使用 `agent_send` 补充或调整方向。
2. browser-agent 中配置的 worker 调用浏览器工具落实操作。
3. director 借助 `agent_poll`、`agent_read_brief` 或 `agent_read` 检查产出。
4. 重复审阅和纠偏，直到获得能够脱离浏览器运行的成果。

编写任务前可调用只读的 `agent_tools`，查询浏览器当前实际开放的能力。

## 执行流程

```text
 director（Claude / GPT）                         browser-agent
 ┌────────────────────────┐    MCP / stdio    ┌──────────────────────────┐
 │ agent_start：明确目标    │ ────────────────▶ │ 低成本 worker 调用 68 项工具 │
 │ agent_poll：查询进度     │                  │ 执行并在阶段门生成结论        │
 │ agent_read*：审核产出    │ ◀─────────────── │                          │
 │ agent_send：调整路线     │ ────────────────▶ │ 根据反馈继续处理             │
 └────────────────────────┘                  └──────────────────────────┘
         └──────── 持续审阅与校正，直至结果可独立运行 ────────┘
```

director 每轮通常只需阅读摘要并给出一条明确指令，因此 token 消耗较低；密集的工具调用和重复验证均由 worker 承担。

## 架构

```text
director（Claude / GPT）
        │ MCP over stdio
        ▼
browser-agent-mcp ── 22 项工具 ── BrowserBridge
        │                         ├─ Marionette（默认）
        │                         └─ FileBridge（备用）
        ├─ agent_start / send / read ...
        ├─ agent_tools（只读能力索引）
        └─ 会话数据：convo / turnlog
                                  │
                                  ▼
            TCP 127.0.0.1:2828 · chrome-context ExecuteScript
                                  │
                                  ▼
              ChromeUtils.importESModule(AgentSession.sys.mjs)
                                  │ run / getState / stop
                                  ▼
                 browser-agent 父进程中的 agentSession 单例
                                  │
                                  ▼
             内置 worker Agent + ledger.md / progress.md
```

`BrowserBridge` 用来隔离通信实现。默认通过 Marionette 连接，必要时可改用 `FileBridge`，无需修改上层工具。

## 安装准备

### 环境要求

1. 安装 [browser-agent](https://github.com/zhang-pre/browser-agent)，并在 Agent 设置中为 worker 配置模型 API Key，例如 DeepSeek、通义千问或 GLM。该 Key 只在浏览器侧使用，本服务不会读取。
2. 使用 Marionette 和系统访问权限启动浏览器，以便在 chrome context 中执行特权 JavaScript。macOS 可通过 LaunchServices 启动：

   ```bash
   open -n -a "/Applications/Browser Agent.app" --args \
       -marionette -remote-allow-system-access -no-remote \
       -profile "<你的 profile>"
   ```

3. 安装 Node.js 18 或更高版本。

### 让编码助手自动配置

在 Cursor、Claude Code、Codex 等工具中发送：

> 请安装并配置 MCP 服务 **browser-agent-mcp**。
>
> 仓库地址：https://github.com/zhang-pre/browser-agent-mcp

编码助手可据此完成克隆仓库、安装依赖、构建项目以及写入 MCP 客户端配置。

## 快速委派

将下面的提示词作为首条消息发送给 director，它会依次检查环境、收集目标、委派任务并验收结果。

```text
你通过名为 browser-agent-mcp 的 MCP 服务，协调 browser-agent 内置的逆向 Agent。

你是 Web 爬虫与签名分析专家，负责判断路线和验收成果，不直接操作浏览器。浏览器中的低成本 worker 承担抓包、追踪、环境补全及脚本验证。每轮只阅读必要结论并给出明确指导，以减少强模型的 token 消耗。

【一、检查环境】
首先调用 frx_status：
- ready=true：继续下一阶段。
- bridgeConnected=false 或 hasKey=false：用一句话转述 note，并指导用户以 -marionette 参数启动浏览器，或在浏览器 Agent 设置中给 qwen-turbo、deepseek-v4-flash 等 worker 模型配置 Key。用户处理后再次检查，确认就绪再继续。

【二、补齐任务信息】
若信息不完整，向用户确认：
1. 可观察目标请求的页面 URL；
2. 需要复现的接口 URL；
3. 待还原的签名或加密参数名；
4. 期望交付物，通常是无需浏览器即可发起有效请求的 Node.js 黑盒实现。

【三、创建会话】
调用 agent_start({task:"将以上信息整理为明确任务", targetUrl:"站点 URL"})，保存返回的 tid，后续调用始终使用该 tid。

在 task 中写明初步判型及建议：普通站点优先通过 hook 与标准算法对照，不必直接深挖混淆代码；遇到 JSVMP 时采用黑盒补环境，不逆向字节码；不要猜测函数名称，先用 signer_trace 捕获真实入参。

【四、等待并审核】
命令行客户端优先循环调用 agent_poll({tid, timeoutSec:60, intervalSec:5})：
- phase="running"：任务仍在处理，并非失败；继续轮询，或改用 agent_wait_for_stop 长等待。
- phase="settled"：先审阅返回的 brief；只有需要完整材料时才调用 agent_read({tid, includeProgressFile:true})。
- phase="error" 或 no-state：组合使用 agent_read_brief({tid}) 与 agent_runlog({tail:30}) 排查原因。

支持长等待的客户端也可直接调用 agent_wait_for_stop({tid})。到达 settled 后，再通过 agent_read_brief 或 agent_read 获取结果。采信结论前必须检查 driftHint，不要把模型退化为纯文本输出或 idle 超时误认为技术路线失败。

【五、纠正方向】
通过 agent_send({tid, guidance:"..."}) 提交具体、有先后顺序且可验证的指导，例如：
- 只执行第 1、2、3 步，每一步验证通过后再继续；
- 优先完成两个简单目标，不要过早深入最困难的 JSVMP；
- 输出不一致时先核对输入，暂不转向字节码逆向；
- 最终仅汇报指定的三项内容。

同时核对 worker 的结论与日志是否冲突，并阻止缺少证据的推断，例如“更换 bundle 必然需要更换密钥”。

【六、循环直至交付】
重复等待、审核和纠偏，直到 Node.js 程序可以独立请求目标接口并得到有效业务数据。路线确定且只剩重复性收尾时，可调用 agent_set_mode({tid, mode:"auto"})；再次卡住则切回 assist。若 worker 已明显偏航，先用 agent_stop({tid}) 停止当前轮，再通过 agent_send 修正。已有进度会写入工作目录，不会因中止而丢失。

现在调用 frx_status 开始检查。
```

## 工具说明

### 状态与能力

| 工具 | 用途 |
|---|---|
| `frx_status` | 任务开始前执行健康检查，返回 Marionette 连接状态、worker provider/model 及 Key 配置情况；未就绪时附带处理建议。 |
| `agent_tools` | 获取 browser-agent 实际注册的 68 项能力，包括 `signer_trace`、`jsvmp_trace`、`closure_read`、`webapi_trace`、`whitebox_diff`、`wasm_probe` 等引擎级分析工具，以及页面、文件、Skills、记忆、指纹环境和扩展管理能力。该工具只返回名称、说明、参数与确认要求，实际操作由 worker 执行。 |

### 会话控制

| 工具 | 用途 |
|---|---|
| `agent_start` | 创建会话、绑定工作目录、选择辅助模式、打开目标页面并提交首轮任务；仅检查 `hasKey`，不会接触 Key。 |
| `agent_poll` | 面向 CLI 的短轮询。默认等待不超过 60 秒；执行中返回 `phase:"running"`，到达阶段门后返回 `phase:"settled"` 并默认附带简报。 |
| `agent_wait_for_stop` | 等待 worker 到达阶段门；超时且任务未结束时仍返回 `phase:"running"`，不表示失败。 |
| `agent_read_brief` | 获取精简报告；默认不含 `progress.md` 和 `ledger.md`，仅保留最近 5 步及约 2000 字内容。 |
| `agent_read` | 读取完整结果，并可包含 `progress.md`、`ledger.md`、`driftHint` 与 `runlogTail`。 |
| `agent_state` | 返回会话存活情况和轻量进度快照。 |
| `agent_send` | 携带上一轮结论并追加指令，是领航模式下的主要纠偏入口。 |
| `agent_set_mode` | 在逐阶段复核的 `assist` 与连续执行的 `auto` 之间切换。 |
| `agent_stop` | 停止当前执行轮；已经写入工作目录的进度仍会保留。 |
| `agent_runlog` | 查看引擎运行记录，用于区分真实路线受阻与模型漂移、空闲超时等执行异常。 |
