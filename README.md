# TSIS_100P_Dashboard

Web dashboard สำหรับข้อมูล cost-saving projects (100P_Dashboard, site 1510/1520) ดึงข้อมูลสดจาก Google Sheets โดยตรงผ่าน **Google Visualization API (gviz)**

## โครงสร้างไฟล์

- `index.html` — โครงหน้าเว็บ
- `styles.css` — ธีม/ดีไซน์
- `app.js` — fetch ข้อมูล (gviz), filter, กราฟ, ตาราง
- `TSIS_Logo.png` — โลโก้บริษัท
- `Generate.gs`, `Webcode.gs` — โค้ด Apps Script ที่รันอยู่ใน Google Sheets (ไม่ใช่ไฟล์ของหน้าเว็บ ไม่ต้องอัปโหลดขึ้น GitHub Pages)

ไม่มี build step ใดๆ — เป็น HTML/CSS/JS ธรรมดา รันได้ทันทีบน GitHub Pages

## สถาปัตยกรรม (อัปเดตล่าสุด)

เดิมหน้าเว็บดึงข้อมูลผ่าน Apps Script Web App (`doGet` ใน `Webcode.gs`) แต่พบปัญหาความไม่เสถียรของ Apps Script Web App บ่อยครั้ง (cold start, URL ล่มเป็นระยะ) จึงเปลี่ยนมาใช้ **gviz** ซึ่งเป็นฟีเจอร์หลักของ Google Sheets เอง อ่านข้อมูลตรงจาก sheet `Master_Log` และ `Master_Log_sale` โดยไม่ผ่าน Apps Script เลย

**ข้อกำหนดสำคัญ:** ไฟล์ Google Sheet ต้องแชร์เป็น **"Anyone with the link — Viewer"** ไม่งั้น gviz จะอ่านข้อมูลไม่ได้ (Apps Script ยังใช้ตามปกติสำหรับปุ่ม **Generate All** ใน Sheets เท่านั้น ไม่เกี่ยวกับการอ่านข้อมูลของหน้าเว็บอีกต่อไป)

## วิธี deploy บน GitHub Pages

1. สร้าง repo ใหม่ชื่อ `TSIS_100P_Dashboard` บน GitHub
2. อัปโหลดไฟล์ `index.html`, `styles.css`, `app.js`, `TSIS_Logo.png` ไว้ที่ root ของ repo
3. ไปที่ **Settings → Pages**
4. ที่ **Source** เลือก **Deploy from a branch**
5. เลือก branch `main` (หรือ branch ที่ push ไฟล์ไว้) และ folder `/ (root)`
6. กด Save รอสักครู่ (ปกติ 1-2 นาที) จะได้ลิงก์รูปแบบ:
   `https://<username>.github.io/TSIS_100P_Dashboard/`

## อัปเดตข้อมูล

หน้าเว็บดึงข้อมูลสดทุกครั้งที่เปิด/กด Refresh (และอัตโนมัติทุก 24 ชม.) ไม่ต้อง deploy หน้าเว็บใหม่เวลาข้อมูลใน Sheet เปลี่ยน — แค่กด **Generate All** ใน Google Sheets (Input_data_SAP + Input_data_sale → Master_Log + Master_Log_sale) แล้วรีเฟรชหน้าเว็บ

## ถ้าเปลี่ยนไฟล์ Google Sheet เป็นไฟล์ใหม่ (Sheet ID เปลี่ยน)

แก้ค่า `SHEET_ID` ที่ใกล้บรรทัดแรกของ `app.js` แล้ว commit ใหม่ (ปกติไม่ต้องแก้บ่อย เพราะ Sheet ID คงที่ตลอดอายุไฟล์ ไม่เปลี่ยนตอน deploy ซ้ำแบบ Apps Script URL)
