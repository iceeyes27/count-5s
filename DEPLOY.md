# 凯格尔计时网页部署说明

当前项目已调整为适合 Cloudflare Pages 的静态站结构：

```text
public/
  index.html
  style.css
  script.js
  _headers
```

其中：

- `public/` 是 Pages 的输出目录
- `public/_headers` 用于配置安全响应头

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

## 3. 绑定自定义域名

在 Pages 项目创建完成后：

1. 打开 `Workers & Pages`
2. 进入你的 Pages 项目
3. 选择 `Custom domains`
4. 添加你的域名，例如 `count-5s.example.com`

如果域名托管也在 Cloudflare，一般会自动完成 DNS 配置。

## 4. 安全性

这个项目是纯静态页，部署到 Pages 后比自建 VPS 更省维护，原因是：

- 不需要暴露 SSH 和源站 Web 服务
- 不需要自己维护 Nginx、系统补丁和证书续期
- HTTPS 由 Cloudflare 托管

当前项目已在 `public/_headers` 中加入这些安全头：

- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Content-Security-Policy`

## 5. 手机浏览器适配

当前页面已经具备：

- `viewport` 视口声明
- 刘海屏安全区 `safe-area` 适配
- 小屏幕单列布局
- 触控点击优化
- 大号倒计时数字和按钮

## 6. 后续更新

以后只需要把代码推送到 GitHub 的 `main` 分支，Cloudflare Pages 会自动重新部署。
