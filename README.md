# 📅 Schedule 课程表插件

<p align="center">
  <img alt="Yunzai Version" src="https://img.shields.io/badge/Yunzai--V3-Plugin-blue?style=flat-square"/>
  <img alt="GitHub release (latest by date)" src="https://img.shields.io/github/v/release/Temmie0125/Yunzai-Schedule-Plugin?style=flat-square"/>
  <img alt="GitHub issues" src="https://img.shields.io/github/issues/Temmie0125/Yunzai-Schedule-Plugin?style=flat-square"/>
  <img alt="GitHub license" src="https://img.shields.io/github/license/Temmie0125/Yunzai-Schedule-Plugin?style=flat-square"/>
  <img alt="GitHub stars" src="https://img.shields.io/github/stars/Temmie0125/Yunzai-Schedule-Plugin?style=social"/>
</p>

## 简介

**Schedule 课程表插件** 是基于 [Yunzai-Bot V3](https://github.com/TimeRainStarSky/Yunzai) 的课程表管理插件。它支持通过 [WakeUP 课程表](https://www.wakeup.fun/) 的口令一键导入课表，并提供课表查询、群友上课状态围观、课表推送订阅等实用功能。

> 🚀 **几乎免配置，开箱即用！**

---

## ✨ 功能特性

- **一键导入**：支持 WakeUP 口令导入，无需繁琐配置
- **跨群共享**：数据与 QQ 绑定，无需每个群单独设置
- **灵活查询**：按周数、日期查询，今日/明日课表一目了然
- **群组互动**：围观群友上课状态，支持“翘课”模式
- **智能学期判断**：自动计算当前周数，学期结束友好提醒
- **定时推送**：订阅后每天推送明日课表（需加好友）
- **个性设置**：自定义昵称、签名，打造专属课表
- **锅巴适配**：支持通过 Guoba 可视化配置
- **高颜主题**：内置一套课表显示主题

---

## 📦 安装方法

### 方式一：使用 Git（推荐，便于更新）

在 Yunzai 根目录下执行：

```bash
git clone --depth=1 https://github.com/Temmie0125/Yunzai-Schedule-Plugin.git ./plugins/schedule
```

### 方式二：手动下载

1. 下载本仓库的 ZIP 压缩包
2. 解压后将文件夹重命名为 `schedule`，放入 `Yunzai/plugins/` 目录
3. 重启 Bot 即可

> 💡 安装后请使用 `#课表帮助` 查看所有命令

---

## ⚙️ 配置说明

### 配置文件位置

- 默认配置：`plugins/schedule/config/default_config/` **请勿修改**
- 用户配置：`plugins/schedule/config/config/` （启动后自动生成）

### 推荐配置方式

本插件已适配 [Guoba-Plugin](https://github.com/guoba-yunzai/guoba-plugin)，建议通过 Guoba 的可视化界面进行配置，无需手动编辑文件。

### 推送时间修改

如需调整课表推送时间（cron 表达式），请修改用户配置后**重启 Bot**生效，其余配置修改无需重启。

---

## 命令列表

| 命令 | 说明 |
|------|------|
| `#设置课表 WakeUP分享口令` | 导入课程表（可直接发送包含「口令」的消息） |
| `#清除课表` | 清除自己的课表 |
| `#课表设置昵称 <昵称>` | 修改显示昵称（≤20字） |
| `#课表设置签名 <签名>` | 设置个性签名（≤30字） |
| `#今日课表` / `#明日课表` | 查看今日/明日课程 |
| `#课表查询 <周数 星期>` | 按周数和星期查询（例：`#课表查询 5 2`） |
| `#课表查询 <月-日>` | 按日期查询（例：`#课表查询 10-1`） |
| `#我的课表` | 查看个人信息及课表概览 |
| `#群课表` 或 `#课程表` | 查看本群群友上课状态 |
| `@某人 在上什么课` | 视奸指定成员的上课状态 |
| `#翘课` / `#取消翘课` | 开启/关闭翘课模式（群内生效） |
| `#开启课表订阅` / `#关闭课表订阅` | 开关次日课表推送（需加 Bot 好友） |
| `#课表更新` | 从 GitHub 更新插件（需主人权限） |

> 更多命令请使用 `#课表帮助` 查看图文帮助。

---

## 项目结构

```
schedule
├─ apps                # 功能模块（命令处理）
├─ components          # 核心管理组件（数据、配置、渲染）
├─ config              # 配置目录
│  ├─ config           # 用户配置（自动生成）
│  └─ default_config   # 默认配置（勿动）
├─ data                # 用户课表数据
├─ guoba               # 锅巴适配目录
│  └─ schemas          # 配置表单
├─ resources           # 静态资源（字体、模板）
├─ services            # 业务服务（导入、解析等）
└─ utils               # 工具函数
```

---

## 贡献指南

欢迎任何形式的贡献！无论是 Bug 反馈、功能建议，还是代码贡献，都请按照以下流程：

### 提交 Issue

- 请先搜索 [Issues](https://github.com/Temmie0125/Yunzai-Schedule-Plugin/issues) 确认是否已有类似问题
- 使用清晰的标题，并详细描述问题或建议
- 如果涉及报错，请提供完整日志和复现步骤

### Pull Request

1. Fork 本仓库并 clone 到本地
2. 创建新的分支：`git checkout -b feature/your-feature`
3. 提交更改，遵循现有代码风格
4. 确保插件在 Yunzai 环境下测试通过
5. 发起 Pull Request，描述改动内容

---

## 反馈与交流

- **GitHub Issues**：[点击反馈](https://github.com/Temmie0125/Yunzai-Schedule-Plugin/issues)
- **作者 QQ**：1179755948（请备注“课程表插件”）
- **官方群**：481221622（也是Hikari-Bot官方群哦~）
- **Yunzai 社区**：欢迎在官方社区交流使用心得

---

## 许可证

本项目采用 **MIT License**，详情请参见 [LICENSE](LICENSE) 文件。

---

## 支持项目

如果这个插件对你有帮助，欢迎给项目点个 Star ⭐，你的支持是我持续更新的动力！
