# TSIS_100P_Dashboard

Web dashboard สำหรับข้อมูล cost-saving projects (100P_Dashboard, site 1510/1520) ดึงข้อมูลสดจาก Google Sheets ผ่าน Apps Script Web App

## โครงสร้างไฟล์

- `index.html` — โครงหน้าเว็บ
- `styles.css` — ธีม/ดีไซน์
- `app.js` — fetch ข้อมูล, filter, กราฟ, ตาราง (แก้ `API_URL` ตรงบรรทัดแรกถ้า deploy Web App ใหม่)

ไม่มี build step ใดๆ — เป็น HTML/CSS/JS ธรรมดา รันได้ทันทีบน GitHub Pages

## วิธี deploy บน GitHub Pages

1. สร้าง repo ใหม่ชื่อ `TSIS_100P_Dashboard` บน GitHub
2. อัปโหลดไฟล์ทั้ง 3 ไฟล์ (`index.html`, `styles.css`, `app.js`) ไว้ที่ root ของ repo
3. ไปที่ **Settings → Pages**
4. ที่ **Source** เลือก **Deploy from a branch**
5. เลือก branch `main` (หรือ branch ที่ push ไฟล์ไว้) และ folder `/ (root)`
6. กด Save รอสักครู่ (ปกติ 1-2 นาที) จะได้ลิงก์รูปแบบ:
   `https://<username>.github.io/TSIS_100P_Dashboard/`

## อัปเดตข้อมูล

หน้าเว็บดึงข้อมูลสดทุกครั้งที่เปิด/กด Refresh ไม่ต้อง deploy หน้าเว็บใหม่เวลาข้อมูลใน Sheet เปลี่ยน — แค่กด **Generate** ใน Google Sheets (Input_data → Master_Log) แล้วรีเฟรชหน้าเว็บ

## ถ้า Web App URL เปลี่ยน (redeploy ใหม่)

แก้ค่า `API_URL` ที่บรรทัดแรกของ `app.js` แล้ว commit ใหม่
