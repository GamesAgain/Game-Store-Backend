# Lotto888
ติดตั้ง packages
  npm install
ทุก API (ยกเว้น Register / Login) ต้องใส่ Authorization Header

Authorization: Bearer <your-token>

👤 Auth
1. Register

POST /api/auth/register

Body (JSON):

{
  "username": "john",
  "email": "john@example.com",
  "password": "123456"
}

2. Login

POST /api/auth/login

Body (JSON):

{
  "usernameOrEmail": "john",
  "password": "123456"
}

✅ Response จะได้ token สำหรับใช้ใน API อื่น ๆ

🎟️ Lotto
1. ปล่อยล็อตโต้ใหม่ (Admin)

POST /api/lottos/release

Header: Authorization: Bearer <admin-token>

Body (JSON):

{
  "count": 10,
  "price": 20
}

2. ดูล็อตโต้ที่ยังไม่ถูกขาย

GET /api/lottos/

3. สุ่มรางวัลจากลอตเตอรี่ทั้งหมด (Admin)

POST /api/lottos/drawAll

4. สุ่มรางวัลจากลอตเตอรี่ที่ถูกซื้อแล้ว (Admin)

POST /api/lottos/drawPurchased

5. ดูผลรางวัล

GET /api/lottos/results

🛒 Orders
1. ซื้อ Lotto

POST /api/orders/buy

Header: Authorization: Bearer <user-token>

Body (JSON):

{ "lid": 5 }

2. ดู Order ของผู้ใช้

GET /api/orders

💰 Wallet
1. ดูยอดเงิน

GET /api/wallet/balance

2. เติมเงิน

POST /api/wallet/topup

Body (JSON):

{ "uid": 2, "amount": 500 }

3. ถอนเงิน

POST /api/wallet/withdraw

Body (JSON):

{ "uid": 2, "amount": 100 }

4. ประวัติธุรกรรม

GET /api/wallet/transactions

Query params: ?page=1&pageSize=10

🛠️ Admin
1. Reset System

DELETE /api/admin/reset

Header: Authorization: Bearer <admin-token>

✅ จะลบ Orders, Lotto, Bounty, wallet_transactions, Users (ยกเว้น admin)
