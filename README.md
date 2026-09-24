# Flux · 微电网储能逐时决策

面向 iPad 的微电网储能控制界面。系统先接收现场量测，再基于该量测生成并提交日内滚动预测；Jev 对未来 24 小时逐时输出 `charge / hold / discharge` 类型化判断、概率分布与置信度，确定性调度引擎负责执行功率、SOC、效率和备用容量等硬约束。

![iPad 逐时调度界面](artifacts/flux-ipad.png)

## 运行

要求 Node.js 20 或更高版本。默认通过界面的临时 BYOK 连接使用 Jev；只有启用受管私有部署时才需要在服务端配置 `TYPESAFE_API_KEY`。

```powershell
npm install
npm run dev
```

开发服务默认打开 <http://127.0.0.1:5173>。如果环境变量刚写入，请先新开一个终端再启动。

生产模式：

```powershell
npm run build
npm start
```

生产服务默认运行在 <http://127.0.0.1:8787>。

## 生产式输入链路

系统不会把现场状态和未来预测一次性塞进同一个请求，而是按时间顺序处理：

1. `POST /api/measurements`：上传当前时刻的负荷、光伏、电网交换功率、储能功率和 SOC；服务返回 `measurementId`。
2. 预测服务以该量测为基准生成滚动预测。
3. `POST /api/dispatch/forecast`：提交 `measurementId`、预测批次信息及 24 小时负荷/光伏/电价序列，触发逐时调度。

调度接口会拒绝不存在、站点不匹配、超过 15 分钟或预测签发时间早于量测时间的量测基准。旧版 `POST /api/dispatch` 仍保留，供现有界面兼容调用。

量测回执是由服务端 `JEV_STATE_ENCRYPTION_KEY` 加密并认证的短时票据，浏览器只拿到不透明的 `measurementId`；任意使用同一环境密钥的 Vercel 实例都能在 15 分钟内解析它。它不替代生产采集链路：现场落地仍应接入 MQTT/Kafka、时序数据库与可审计的持久化状态仓库。

## 功能

- iPad 横屏侧边栏、主决策台和右侧输入检查器，1024/1194 宽度下一屏展示核心信息。
- UI 真实执行“量测入库 → 滚动预测 → Jev 决策”，展示每阶段状态与追踪 ID。
- 三个可切换场景：晴空高光伏、制造晚高峰、午后光伏骤降。
- 场站容量、功率和备用 SOC 作为只读硬约束；测试模式仅调整下一轮模拟量测 SOC。
- 24 小时负荷、光伏、电网、储能功率和 SOC 联合图表。
- Jev 每小时动作、完整概率分布、置信度和模型信息。
- 日运行成本、节省、削峰、绿电利用率、自供率和等效循环指标。
- 首屏、连接失效和主动断开后只显示 Jev 连接准备页；不会自动生成本地基线、量测、预测或充放电结果。连接验证完成后仍需明确点击“开始逐时决策”。

## Jev 的职责边界

后端把“已观测状态”和“未来预测”作为两个具名的结构化 state 传给 Jev，并在一次 `systemOne` 请求中并行提交 24 个 `Choice` 问题。Jev 比较各时段动作的语义价值，代码负责：

- 量测先于预测的时序校验；
- 逐时 AC 能量平衡；
- 最大充放电功率；
- 最小、最大和备用 SOC；
- 往返效率；
- 禁止储能向电网反送；
- 成本和运行指标计算。

这遵循“模型给判断、代码做执行”的设计。服务端环境密钥不会进入浏览器 bundle 或报文截图；用户自带密钥会经一次性 HTTPS 请求换取短期、加密的会话凭证，不会被加入调度报文或 Jev trace。

## Jev 连接与公开部署安全

界面可以让用户输入自己的 Jev API Key，但它不是浏览器的长期凭据管理器：Key 只作为写入式输入通过 HTTPS 提交给服务端校验。服务端将其 AES-256-GCM 加密为不透明会话凭证；浏览器只在当前页面内存中保存该凭证，并通过 `X-Jev-Session` 发送。不能使用 LocalStorage、SessionStorage、URL、分析事件或日志保存 Key / 凭证。

- `POST /api/jev/session`：后端用 `models.list()` 校验 Key，返回不含原始 Key 的加密短时凭证。
- `GET /api/jev/session` 和成功的调度响应会在 `X-Jev-Session-Renewed` 中轮换凭证，以维持滚动的 5 分钟闲置上限。
- 会话绝对有效期最长 15 分钟；到期、篡改或空凭证会得到 `401 jev_session_expired`，**不会**回退使用 `TYPESAFE_API_KEY`。
- `DELETE /api/jev/session` 是幂等确认，页面随后清除它唯一持有的凭证。无状态 Vercel 版本不能单独全局撤销已经签发的凭证；它仍会在最迟 5 分钟闲置、最长 15 分钟后失效。若需要立即全局吊销，应使用 Redis 拒绝表或轮换 `JEV_STATE_ENCRYPTION_KEY`。
- API 响应采用 `no-store`，并附带来源校验、精确 CORS allowlist、拒绝 iframe、禁用嗅探和最小权限头；上游 Jev 错误不会原样返回页面。

`JEV_ALLOW_ENVIRONMENT_KEY=false` 很关键：即便服务配置了 `TYPESAFE_API_KEY`，匿名访问者也无法消耗部署者的 Key，必须创建自己的临时会话。任何以 `VITE_` 开头的变量都会进入浏览器构建产物，绝不能放入 Jev Key 或 `JEV_STATE_ENCRYPTION_KEY`。该设计降低无意持久化与公开站点滥用风险，但不能抵御被恶意脚本、浏览器扩展或用户设备入侵的页面环境；生产账户应再叠加身份认证、WAF、分布式限流和可撤销会话存储。

## Vercel 发布（推荐）

项目已经是同域全栈部署：Vite 页面托管在 `/`，Express API 由 `/api/[...path]` Node Function 提供，`vercel.json` 会排除 `/api` 后再做 SPA 回退。因此部署后只需打开一个 Vercel 地址，**不用填写独立 API 部署地址，也不要设置 `VITE_API_BASE_URL`**。

在 Vercel 项目的 Production 环境配置以下变量：

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `JEV_STATE_ENCRYPTION_KEY` | 新生成的 32-byte base64url Secret | 跨函数实例加密量测票据与临时 Jev 会话，必填。 |
| `JEV_ALLOW_ENVIRONMENT_KEY` | `false` | 公开站点只允许访客使用自己的临时 Jev 连接。 |
| `TRUST_PROXY` | `1` | 让 Express 正确识别 Vercel 转发的 HTTPS。 |

可用下列命令生成第一项的值；只复制到 Vercel Secret，不要提交到 `.env`、Git 或 `VITE_` 变量：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

公开 BYOK 部署不需要、也不应设置 `TYPESAFE_API_KEY`。如果要做仅自己可用的受管 Key 演示，请先开启 Vercel Deployment Protection / 应用身份认证，再把**已轮换的新 Key**以 Secret 写入 `TYPESAFE_API_KEY`，并显式设置 `JEV_ALLOW_ENVIRONMENT_KEY=true`。不要把曾在聊天、截图或代码中出现过的 Key 作为长期生产凭据。

## GitHub Pages 本地仿真版

仓库包含 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)。GitHub Pages 版本可直接运行一条完整的本地仿真路径：载入内置样本量测、生成 24 小时预置预测，并用与服务端共用的确定性功率、SOC 和需量约束计算充放电计划。结果会持续标为“本地仿真 · 未调用 Jev”，不是现场数据或生产控制指令。

该路径不会运行 `/api`、接收 Jev Key、连接现场设备，也不会发起 Jev、应用 API 或现场设备网络请求；样本输入和规则输出可在页面的“仿真数据”入口审阅。工作流不需要任何 Actions Secret 或 Variable，也不会向 GitHub Actions、Pages 或前端 bundle 注入 `TYPESAFE_API_KEY`、Jev Key、会话令牌或 `VITE_API_BASE_URL`。在仓库 **Settings → Pages** 选择 **GitHub Actions** 作为 Source 后，推送 `main` 即可发布到 `https://<owner>.github.io/<repository>/`。

若需要可运行的 Jev 决策，请部署同域 Node API（推荐 Vercel）或受信任的独立 API 服务；密钥只能写入该服务的环境变量，不能写入 GitHub Pages、GitHub Actions Variable 或任何 `VITE_` 变量。

## 报文样例

- `artifacts/microgrid-measurement.json`：实时量测输入。
- `artifacts/microgrid-forecast-request.json`：携带 `measurementId` 的预测请求。
- `artifacts/microgrid-dispatch-response.json`：完整 24 小时调度输出。
- `artifacts/microgrid-terminal-request.png`：两阶段终端输入截图。
- `artifacts/microgrid-terminal-response.png`：终端输出截图。

## 验证

```powershell
npm run test
npm run build
npm run build:pages
npm run qa:pages
```

测试覆盖量测/预测时序、量测 SOC 作为预测基线、功率与 SOC 边界、逐时能量平衡，以及低价充电和晚峰放电行为。

## 重要说明

本项目用于算法测试和产品演示，不包含设备通信、保护定值、预测校准或生产级优化器，不应直接控制真实储能设备。生产落地前应使用现场数据验证 Jev 判断阈值，并接入 EMS 的安全联锁、审批和回滚机制。
