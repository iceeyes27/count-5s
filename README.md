# count-5s

一个适合手机浏览器使用的凯格尔运动计时网页。

## 页面示例

![凯格尔计时网页示例](./assets/app-preview.svg)

## 功能

- 5 秒收紧
- 5 秒停留
- 自动循环
- 已完成轮次统计
- 总练习秒数统计
- 开始、暂停、重置

## 项目结构

```text
public/
  index.html
  style.css
  script.js
  _headers
```

## Cloudflare Pages

推荐部署到 Cloudflare Pages。

- Build command: `exit 0`
- Build output directory: `public`
- 安全响应头: `public/_headers`

详细说明见 [DEPLOY.md](./DEPLOY.md)。
