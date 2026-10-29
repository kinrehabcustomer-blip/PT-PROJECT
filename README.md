# PT Care

ระบบต้นแบบสำหรับจัดการนัดหมายกายภาพบำบัดและติดตามคอร์ส สร้างด้วย React และ Next.js App Router โดยแยกโค้ดตาม Clean Architecture

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

เปิด `http://localhost:3000`

ตรวจสอบโค้ดและกฎการตัดคอร์ส:

```bash
npm run lint
npm run typecheck
npm test
```

## โครงสร้าง

- `src/domain` — โมเดลและกฎของโดเมน
- `src/application` — use cases: นัดหมาย (สร้าง/เลื่อน/ยกเลิก/ไม่มาตามนัด/ตัดคอร์ส), คอร์ส (แก้ไข/คืนสิทธิ์พร้อม audit), วางแผนแจ้งเตือน และส่งแจ้งเตือน (`MessageGateway` เป็น port)
- `src/infrastructure/repositories` — ที่เก็บข้อมูลแบบไฟล์ JSON ฝั่งเซิร์ฟเวอร์ (`data/db.json`) และข้อมูลตัวอย่าง
- `src/infrastructure/line` — adapter ส่งข้อความ LINE Messaging API
- `src/infrastructure/api` — HTTP client ฝั่งเบราว์เซอร์
- `src/app/api` — Route Handlers (`/api/appointments`, `/api/courses`, `/api/settings`, `/api/notifications/dispatch`)
- `src/presentation` — components แยกหมวด และ state กลาง
- `src/app` — หน้า ภาพรวม/นัดหมาย, คอร์สการรักษา, แจ้งเตือน

## Deploy บน Vercel + Neon (Postgres)

Vercel เขียนไฟล์ไม่ได้ ระบบจึงเก็บข้อมูลใน **Neon Postgres** เมื่อมีค่า `DATABASE_URL` (ลำดับที่ใช้: Postgres → Upstash Redis → ไฟล์ในเครื่อง ถ้ารันบน Vercel แล้วไม่ได้ตั้งค่า ระบบจะแจ้ง error ชัดเจน ไม่เงียบหาย)

1. สร้างโปรเจกต์ที่ [neon.tech](https://neon.tech) (เลือก region ใกล้ไทย เช่น Singapore) แล้วคัดลอก **connection string** แบบ **Pooled connection** (host มี `-pooler`)
2. สร้างตาราง: ใส่ `DATABASE_URL=...` ใน `.env.local` แล้วรัน `npm run db:migrate` (สร้างตารางครบ + ค่าตั้งต้น ฐานข้อมูลว่างพร้อมใส่ข้อมูลจริง) หรือใช้ `npm run db:migrate -- --demo` ถ้าต้องการข้อมูลตัวอย่าง
   - หรือเปิดไฟล์ [db/schema.sql](db/schema.sql) วางใน Neon Console → **SQL Editor** แล้วรัน จากนั้นรันบรรทัดนี้ต่อเพื่อให้ระบบเริ่มต้นด้วยฐานข้อมูลว่าง: `INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;`
3. Vercel → Settings → **Environment Variables** ใส่: `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_ADMIN_USER_ID` แล้ว **Redeploy**
4. เปิดเว็บ ล็อกอิน `admin` ด้วย `ADMIN_PASSWORD` ครั้งแรก แล้วสร้างบัญชีอื่นที่หน้า "ผู้ใช้และทีม"
5. LINE Developers Console → Webhook URL = `https://<โดเมน>/api/line/webhook` → Verify (หรือ `npm run line:check -- https://<โดเมน>`)
6. ตัวส่งตามเวลา: แผนฟรี (Hobby) ของ Vercel ตั้ง cron ได้วันละครั้ง จึงใช้ [cron-job.org](https://cron-job.org) (ฟรี) เรียก `GET https://<โดเมน>/api/notifications/dispatch` ทุก 5 นาที พร้อมหัว `Authorization: Bearer <CRON_SECRET>`

ตาราง: `patients`, `therapists`, `courses`, `course_history`, `appointments`, `notifications`, `course_audit`, `users`, `credentials` (รหัสผ่านแบบ hash แยกจาก users), `link_codes`, `settings`, `rate_limits`, `locks` การเขียนทุกครั้งอยู่ใน transaction เดียวพร้อม advisory lock จึงไม่ทับกันเมื่อมีหลายคนใช้พร้อมกัน และเขียนเฉพาะแถวที่เปลี่ยน ระบบลบประวัติแจ้งเตือนที่เสร็จแล้วเก่ากว่า 90 วันให้อัตโนมัติ (ประวัติการแก้ไขคอร์สไม่ถูกลบ)

## เริ่มใช้งานครั้งแรก (เครื่องตัวเอง)

1. คัดลอก `.env.example` เป็น `.env.local` แล้วตั้ง `AUTH_SECRET` และ `ADMIN_PASSWORD`
2. เปิด `/login` เข้าด้วยชื่อผู้ใช้ `admin` และรหัสผ่านจาก `ADMIN_PASSWORD` (ใช้สร้างบัญชีแอดมินครั้งแรกเท่านั้น หลังจากนั้นเปลี่ยนรหัสได้ที่หน้า "ผู้ใช้และทีม")
3. สร้างบัญชีเจ้าหน้าที่และนักกายภาพที่หน้า "ผู้ใช้และทีม" (บัญชีนักกายภาพต้องเชื่อมกับรายชื่อนักกายภาพ)

สิทธิ์: **แอดมิน** ทำได้ทุกอย่าง · **เจ้าหน้าที่** จัดการนัด ผู้รับบริการ คอร์ส (แต่แก้ตัวเลขคอร์สและตั้งค่าไม่ได้) · **นักกายภาพ** เห็นเฉพาะนัดของตน กดรับทราบและบันทึกให้บริการได้เฉพาะนัดตัวเอง รหัสผ่านเก็บแบบ scrypt ส่วนสิทธิ์ตรวจที่ฝั่งเซิร์ฟเวอร์ทุกครั้ง

## ตั้งค่า LINE

1. ใส่ `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_ADMIN_USER_ID`
2. ในคอนโซล LINE ตั้ง Webhook URL เป็น `https://<โดเมน>/api/line/webhook`
3. ผูกบัญชี: ที่หน้า "ผู้รับบริการ" (ผู้ป่วย/ญาติ) หรือ "ผู้ใช้และทีม" (นักกายภาพ) กด "สร้างรหัสผูก LINE" แล้วให้ผู้นั้นพิมพ์รหัส `PT-XXXXXX` ส่งไปที่ LINE Official Account (ใช้ได้ครั้งเดียว หมดอายุใน 24 ชม.)
4. ตั้งตัวจัดเวลาภายนอก (cron, Task Scheduler ฯลฯ) เรียก `GET /api/notifications/dispatch` พร้อมหัว `Authorization: Bearer <CRON_SECRET>` ทุก 1–5 นาที ระบบจะส่งเฉพาะรายการที่ถึงกำหนด

หากยังไม่ตั้งค่าหรือผู้รับยังไม่ผูก LINE รายการจะขึ้นสถานะ "ไม่ได้ส่ง" พร้อมเหตุผล ไม่แสดงว่าส่งสำเร็จ และ**จะไม่ถูกส่งซ้ำอัตโนมัติภายหลัง**

## กฎการตัดคอร์ส

- ตัด 1 ครั้งเมื่อนักกายภาพบันทึก "ให้บริการแล้ว" เท่านั้น และตัดซ้ำไม่ได้
- ยกเลิก/เลื่อนนัดไม่ตัดคอร์ส; "ไม่มาตามนัด" ไม่ตัดจนกว่าแอดมินเลือก ตัด/ไม่ตัด
- แก้จำนวนครั้งหรือยกเลิกรายการตัดคอร์สได้เฉพาะแอดมิน ต้องระบุเหตุผล และบันทึกประวัติการแก้ไข
- แจ้งแอดมินเมื่อคอร์สเหลือ 3, 1 และ 0 ครั้ง (ครั้งเดียวต่อระดับ รวมคอร์สที่อยู่ในระดับนี้อยู่แล้วเมื่อตัวส่งทำงานครั้งแรก)
- ผู้รับบริการที่มีหลายคอร์สต้องเลือกคอร์สตอนลงนัด

## ข้อจำกัดที่ต้องรู้ก่อนใช้งานจริง

- ถ้าไม่ตั้ง `DATABASE_URL` (หรือ Redis) ระบบเก็บเป็นไฟล์ JSON (`data/`) ซึ่งใช้ได้กับเครื่องเดียวที่เปิดตลอดเท่านั้น และต้องสำรองโฟลเดอร์ `data/` ส่วน Redis แผนฟรีควรตั้งการสำรองข้อมูลหรือส่งออก CSV เป็นระยะ
- ข้อมูลหน้าจอรีเฟรชอัตโนมัติทุก 10 วินาทีขณะเปิดแท็บ (polling) ไม่ใช่ push แบบทันที
- ยังไม่มีการยืนยันตัวตนสองชั้น และผู้ป่วยเปลี่ยนนัดเองผ่าน LINE ไม่ได้ (ต้องโทรหาเจ้าหน้าที่ตามเบอร์ในข้อความ)
- เบอร์ติดต่อเลื่อน/ยกเลิกนัดเริ่มต้นเป็นค่าตัวอย่าง `02-000-0000` ต้องแก้ในหน้า "แจ้งเตือน"
- การตั้งเวลาแจ้งเตือนมีผลกับนัดที่สร้างหรือเลื่อนหลังบันทึกการตั้งค่า
- ข้อมูลสุขภาพในชุดตัวอย่างเป็นข้อมูลสมมติ
