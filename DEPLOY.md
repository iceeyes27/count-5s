# 凯格尔计时网页部署说明

当前项目已调整为适合 Cloudflare Pages + Pages Functions + D1 的结构：

```text
functions/
  api/
    stats.js
public/
  index.html
  style.css
  script.js
  _headers
  _routes.json
```

其中：

- `public/` 是 Pages 的输出目录
- `public/_headers` 用于配置安全响应头
- `public/_routes.json` 让 Functions 只接管 `/api/*`
- `functions/api/stats.js` 提供打卡数据读写接口
- `KEGEL_DB` 是 D1 绑定名

## 1. GitHub 仓库准备

把项目推送到 GitHub 后，再由 Cloudflare Pages 直接连接仓库自动部署。

## 2. 在 Cloudflare Pages 创建项目

根据 Cloudflare Pages 官方文档，静态 HTML 站点可以直接部署到 Pages；如果没有构建步骤，推荐使用 `exit 0` 作为构建命令，并把输出目录指向静态文件所在目录。来源：

- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- https://developers.cloudflare.com/pages/get-started/

在 Cloudflare 后台创建 Pages 项目时使用以下设置：

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `public`

Pages 会自动识别仓库根目录下的 `functions/` 目录，因此不需要额外构建命令。

## 3. 创建 D1 数据库并绑定到 Pages

当前版本把“每日累计轮次”和“是否已打卡”持久化到 Cloudflare D1。你需要在 Cloudflare 后台完成以下配置：

1. 打开 `Workers & Pages`
2. 进入 `D1 SQL Database`
3. 创建一个数据库，例如 `count-5s-db`
4. 打开你的 Pages 项目
5. 进入 `Settings`
6. 选择 `Bindings`
7. 新增 `D1 database binding`
8. Variable name 填 `KEGEL_DB`
9. 绑定刚创建的数据库

`functions/api/stats.js` 已包含 `CREATE TABLE IF NOT EXISTS`，首次请求会自动补齐表结构。

## 4. 绑定自定义域名

在 Pages 项目创建完成后：

1. 打开 `Workers & Pages`
2. 进入你的 Pages 项目
3. 选择 `Custom domains`
4. 添加你的域名，例如 `count-5s.example.com`

如果域名托管也在 Cloudflare，一般会自动完成 DNS 配置。

## 5. 安全性

这个项目的前端仍然是静态页，后端只增加了一个很小的 Pages Function，维护成本仍然很低，原因是：

- 不需要维护源站 Web 服务
- 不需要自己处理证书续期和服务器补丁
- HTTPS 由 Cloudflare 托管
- 打卡数据直接存放在 Cloudflare D1

当前项目已在 `public/_headers` 中加入这些安全头：

- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Content-Security-Policy`

## 6. 手机浏览器适配

当前页面已经具备：

- `viewport` 视口声明
- 刘海屏安全区 `safe-area` 适配
- 小屏幕单列布局
- 触控点击优化
- 大号倒计时数字和按钮

## 7. 本地调试

仅查看页面布局：

```powershell
python -m http.server 8000 -d public
```

需要连同 `/api/stats` 和 D1 一起调试，建议用 Wrangler：

```powershell
npx wrangler pages dev public
```

如果你要在本机连真实 D1，再把 `KEGEL_DB` 绑定到本地 dev 环境。

## 8. 后续更新

以后只需要把代码推送到 GitHub 的 `main` 分支，Cloudflare Pages 会自动重新部署。
