# claude-mods

ชุด mod ส่วนตัวสำหรับ Claude Code (2.1.293 ขึ้นไป)

## ติดตั้งจากเครื่อง (ระหว่างพัฒนา)

```bash
claude plugin marketplace add ~/Documents/claude-mods
```

```bash
claude plugin install forge@claude-mods
```

แก้โค้ดแล้วพิมพ์ `/reload-plugins` ใน session

## ตั้งค่า repo ครั้งแรก

```bash
git config core.hooksPath .githooks
```

สร้าง `.forbidden-words` (ไม่ commit) ใส่ชื่อบริษัทและ domain ภายในบรรทัดละคำ

## Plugins

- `forge` — บังคับกฎของ repo (`.claude/guards.json`) และกฎในตัว ก่อนคำสั่งจะรัน · `/guards`
