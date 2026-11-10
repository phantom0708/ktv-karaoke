# KTV

Lounge karaoke 3D trên sân thượng: nhân vật chibi, sảnh đi lại được, 8 phòng hát, phát YouTube đồng bộ, mic WebRTC có hiệu ứng.

## Chạy

```bash
npm install
npm start                      # http://localhost:8080
YT_API_KEY=... npm start       # (tuỳ chọn) dùng YouTube Data API chính thức; không có key vẫn tìm được bài
BOTS_PER_ROOM=0 npm start      # tắt bot trong phòng (mặc định 2), BOTS_IN_LOBBY (mặc định 3)
npm test                       # chạy toàn bộ test
```

### Quản trị & xu

Server đang chạy, trên chính máy đó:

```bash
npm run admin -- <tên đăng nhập>          # cấp quyền quản trị (thêm "off" để thu hồi)
npm run coins -- <tên đăng nhập> 5000     # nạp xu (số âm để trừ)
```

Tài khoản quản trị có nút **👑 Quản trị** ở sảnh để nạp xu ngay trong game. Lệnh dùng khoá bí mật tự sinh ở `data/admin.key` (không đưa khoá này cho người khác).
Ngoài ra mọi tài khoản tự nhận **+20 xu mỗi 5 phút online**.

### Mic từ máy khác trong mạng

Trình duyệt chỉ cho dùng mic trên `https://` hoặc `localhost`. Server tự mở thêm HTTPS ở cổng 8443 (chứng chỉ tự ký):

```bash
npm run cert        # tạo/cập nhật chứng chỉ cho localhost + các IP của máy (chạy lại khi đổi mạng)
npm start           # in ra địa chỉ dạng https://192.168.x.x:8443
```

Trên điện thoại / máy khác mở địa chỉ https đó, bấm "Nâng cao → Tiếp tục" ở cảnh báo chứng chỉ, rồi cho phép Micro.
Người chơi ở **mạng khác nhau** (4G, mạng công ty…) cần TURN server. KTV dùng **Cloudflare TURN miễn phí** (1.000 GB/tháng):

1. Cloudflare Dashboard → **Realtime → TURN Server → Create** → lấy *Turn Token ID* và *API Token*.
2. Tạo file `data/turn.json` (không chia sẻ file này):
   ```json
   { "keyId": "TURN_TOKEN_ID", "apiToken": "API_TOKEN" }
   ```
   hoặc đặt biến môi trường `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN`.
3. Khởi động lại server — log in ra `ICE: cloudflare`. Server tự xin thông tin đăng nhập 24 giờ và làm mới mỗi 12 giờ; nếu Cloudflare lỗi thì tự quay về STUN.

Không có key thì dùng STUN miễn phí (`stun.cloudflare.com`). TURN khác: `TURN_URL=turn:host:3478 TURN_USER=... TURN_PASS=... npm start`.

### Mic qua Cloudflare SFU (phòng đông)

Mặc định mic nối thẳng giữa các máy (mesh): phòng 40 người thì người hát phải gửi 39 luồng. Khi có key **Cloudflare Realtime SFU** (miễn phí, chung hạn mức 1.000 GB/tháng với TURN), mỗi máy chỉ giữ **1 kết nối** tới Cloudflare: gửi mic lên 1 lần, Cloudflare chia cho cả phòng.

1. Cloudflare Dashboard → **Realtime → SFU → Create application** → lấy *App ID* và *App Secret (API token)*.
2. Tạo file `data/sfu.json` (không chia sẻ file này):
   ```json
   { "appId": "APP_ID", "appSecret": "APP_SECRET" }
   ```
   hoặc đặt biến môi trường `CF_SFU_APP_ID` / `CF_SFU_APP_SECRET`.
3. Khởi động lại — log hiện `voice: cloudflare-sfu`. Không có key thì `voice: mesh` (như cũ).

Secret chỉ nằm ở server: trình duyệt gửi SDP qua WebSocket của KTV (`sfu` messages), server gọi API Cloudflare (`server/sfu.js`).

## Tính năng

**Tài khoản** — chơi ngay bằng khách, hoặc đăng ký/đăng nhập (mật khẩu băm scrypt). Khách có thể nâng cấp lên tài khoản giữ nguyên nhân vật. Xu, điểm danh, cửa hàng chỉ dành cho tài khoản.

**Nhân vật** — 5 tab: cơ thể (3 dáng, màu da), khuôn mặt (5 kiểu mắt, 4 miệng, 3 lông mày, má hồng), tóc (8 kiểu, màu), trang phục (5 áo, 3 kiểu dưới, màu giày), phụ kiện (kính, kính râm, bông tai, băng đô). Nút ngẫu nhiên / mặc định, xem trước 3D xoay.

**Sảnh** — sân thượng lúc hoàng hôn, đi lại WASD / bấm sàn, cửa 8 phòng có đèn trạng thái (xanh trống · cam đang hát · đỏ đầy), nhấn E ở cửa để vào. Quầy lễ tân (NPC Hạ Vy) với 6 tab: Phòng (kèm "phòng vui nhất"/"phòng trống"), Điểm danh 7 ngày liên tục, Xếp hạng tuần (hát nhiều nhất, được tặng quà nhiều nhất, chịu chi nhất), Cửa hàng, Tủ đồ, Hướng dẫn.

**Phòng hát**
- Máy chọn bài cạnh sân khấu: 9 thể loại, lọc tone nam/nữ, tìm theo tên trên YouTube (không cần key), xem thêm, dán link YouTube.
- Hàng chờ (tối đa 3 bài/người), chủ phòng được ưu tiên bài và xoá bài.
- Người hát tự lên sân khấu, cầm mic; video phát trên màn hình 3D, đồng bộ cả phòng.
- Dừng / tiếp tục / qua bài: người hát và chủ phòng làm trực tiếp; người khác gửi yêu cầu, người hát đồng ý hoặc từ chối.
- Song ca: mời 1 người, người được mời nhận lời; rời song ca.
- Mic: âm li (Tắt / Karaoke / Hội trường / Phòng thu), Bass/Mid/Treble, Echo, Độ lặp, Reverb, độ trễ, độ lớn mic, lọc ồn, chế độ tai nghe, âm lượng nhạc và giọng người khác.
- Bàn tiệc: bia, nước ngọt, hoa quả, bánh kem, pizza (có tồn kho); F uống/ăn, G cụng ly với người đứng gần; uống bia tăng độ say → đi loạng choạng, giảm dần.
- Phục vụ (anh Tú cạnh cửa ra): gọi thêm đồ, hiệu ứng sân khấu (pháo giấy, pháo hoa lạnh, bóng bay, bong bóng), tặng người đang hát (bó hoa, ngôi sao, cúp vàng).
- Bảng công tắc: đèn phòng, disco, đèn nháy, laser, khói.
- Ghế sofa (10 chỗ), cảm xúc (6), động tác (nhảy, vẫy tay), chat có bong bóng, chế độ xem màn hình.
- Bot dễ thương đi lại, ngồi, uống, cổ vũ và chào người mới.

**Xu** — +1 mỗi 10 giây có nhạc, hát xong ≥ 60% bài: +40 (có khán giả) / +20 (một mình), được thả cảm xúc +3/người (tối đa 30/bài), được tặng quà nhận 80% giá trị, điểm danh 50 → 200.

**Cửa hàng** — 34 món ở 7 loại: bảng tên, đồ đội đầu, sau lưng, hào quang, thú cưng (đi theo nhân vật), micro, hiệu ứng xuất hiện khi vào phòng.

**Ngôn ngữ** — Tiếng Việt / English.

## Cấu trúc

| Tệp | Vai trò |
|---|---|
| `server/space.js` | Không gian chung: thành viên, di chuyển, chat, động tác |
| `server/rooms.js` | Phòng hát: hàng chờ, phát, xin quyền, song ca, bàn tiệc, phục vụ, hiệu ứng, ghế, xu — có test |
| `server/hosts.js` | Gọi nhân viên ngồi cùng (💃 em gái bốc lửa / 🕺 anh 6 múi): 300 xu / 10 phút, tối đa 4 người mỗi phòng, ngồi cạnh, rót bia, cổ vũ, nhảy — có test |
| `server/sfu.js` | Mic qua Cloudflare Realtime SFU: tạo session, publish/pull track, renegotiate — giữ secret phía server; không có key thì client dùng mesh — có test |
| `server/clubs.js` | Câu lạc bộ: lập (1.000 xu), tag trên tên, chat riêng, tối đa 30 người, mở/cần duyệt, điểm tuần từ hoạt động, top 3 tuần nhận xu — có test |
| `server/gate.js` | Giới hạn người chơi (`MAX_ONLINE`, mặc định 300) + hàng chờ (`MAX_WAITING` 500), xem `/api/status` — có test |
| `server/dancers.js` | Gọi vũ công lên sân khấu (500 xu / 5 phút) — có test |
| `server/profiles.js` | Tài khoản, khách, nhân vật, xu, cửa hàng, điểm danh, xếp hạng tuần; lưu `data/db.json` — có test |
| `server/bots.js` | Bot trong sảnh và phòng |
| `server/index.js` | HTTP, WebSocket `/ws`, định tuyến tin nhắn, chuyển tiếp WebRTC, `/api/search` |
| `public/js/three/toon.js` | Vật liệu cel-shading, viền mực, quầng sáng, chữ trên canvas |
| `public/js/three/avatar.js` | Nhân vật chibi, đồ mặc, thú cưng, hoạt ảnh |
| `public/js/three/engine.js` | Renderer, camera bám theo, di chuyển + va chạm, tương tác E, nhãn, video sau màn hình 3D |
| `public/js/three/worlds.js` | Sảnh sân thượng và phòng lounge |
| `public/js/three/fx.js` | Disco, laser, khói, đèn nháy, pháo giấy, bóng bay, quà, hiệu ứng xuất hiện |
| `public/js/creator.js` | Màn tạo nhân vật |
| `public/js/main.js` | Giao diện, hộp thoại, luồng màn hình |
| `public/js/{net,video,voice,i18n}.js` | Kết nối, đồng bộ YouTube, mic + WebRTC, ngôn ngữ |

## License

MIT — xem [LICENSE](LICENSE).
