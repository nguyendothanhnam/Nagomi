# Nagomi — Ứng dụng trò chuyện cộng đồng

## Giới thiệu

Nagomi là ứng dụng giao tiếp cộng đồng, giúp người dùng kết nối với bạn bè và tham gia các máy chủ (server) theo nhóm sở thích. Ứng dụng hướng đến trải nghiệm trò chuyện trên thiết bị di động, kết hợp nhắn tin trực tiếp, kênh trò chuyện và giao tiếp bằng giọng nói.

## Tính năng chính

- Tạo tài khoản, đăng nhập và quản lý hồ sơ cá nhân.
- Kết bạn và nhắn tin riêng theo thời gian thực.
- Tạo, tham gia và quản lý server; hỗ trợ lời mời thành viên.
- Tổ chức hội thoại theo các kênh văn bản và kênh thoại.
- Gửi tin nhắn trong kênh và xem lịch sử trò chuyện.
- Hỗ trợ giao tiếp thoại; tích hợp thư viện WebRTC ở ứng dụng di động.
- Tải lên và sử dụng ảnh đại diện, biểu tượng server.
- Có các API cho tính năng nhạc trong kênh.

## Công nghệ

| Thành phần | Công nghệ |
| --- | --- |
| Ứng dụng di động | React Native, Expo, JavaScript/TypeScript |
| Điều hướng | Expo Router, React Navigation |
| Giao tiếp thời gian thực | WebSocket, STOMP, SockJS; WebRTC cho thoại |
| Backend | Java 21, Spring Boot, Spring Web, WebSocket, Firebase Admin SDK |
| Cơ sở dữ liệu | Cloud Firestore (Firebase) |
| Xác thực | JWT; BCrypt để băm mật khẩu |

## Cấu trúc dự án

```text
.
├── Frontend/   # Ứng dụng di động Expo/React Native
├── Backend/    # API và dịch vụ Spring Boot
```

Frontend chứa các màn hình đăng nhập, đăng ký, hồ sơ, bạn bè, server, chat và thoại. Backend chứa các API, mô hình dữ liệu, truy cập cơ sở dữ liệu và cấu hình WebSocket.

## Chạy dự án trong môi trường phát triển

### Frontend

```bash
cd Frontend
npm install
npm run start:go
```

Frontend dùng Expo SDK 58. Để chạy trên Android thật, cài Expo Go hỗ trợ SDK 58, kết nối cùng Wi-Fi với máy tính rồi mở Expo Go để quét QR. Lệnh `npm run start:go` chọn Expo Go và cố định cổng Metro ở `8081`; không mở đường dẫn `/_expo/loading` cũ trong trình duyệt.

Expo Go dùng được các màn hình đăng nhập, nhắn tin và tin nhắn thoại. Trên Android/iOS, gọi thoại/video WebRTC cần development build riêng có các module native tương ứng. Sau khi nâng SDK, cần dựng lại development build; thư mục native `Frontend/android` cũ không được dùng nguyên trạng cho SDK mới.

### Kênh thoại và camera trên web

Khi Metro đang chạy, nhấn `w` để mở web, hoặc dùng `npm run web`. Trên laptop, truy cập bằng `http://localhost:8081` và cho phép micro. Nút camera sẽ yêu cầu quyền camera khi được bấm. Web dùng WebRTC của trình duyệt và signaling STOMP cùng backend, không cần APK. Nếu trình duyệt chặn tự phát âm thanh, bấm nút "Bấm để nghe âm thanh cuộc gọi" trong kênh.

Để thử giữa web và điện thoại, dùng hai tài khoản khác nhau, vào cùng một kênh; điện thoại mở app Nagomi development build. Trình duyệt cần secure context (`localhost` hoặc HTTPS) để dùng micro/camera; địa chỉ LAN dạng HTTP thường không đáp ứng điều kiện này. Cả hai phía phải truy cập được backend cổng `8080`. Khi triển khai web bằng HTTPS, backend và WebSocket cũng cần địa chỉ HTTPS/WSS phù hợp. Cấu hình hiện chỉ có STUN; gọi qua các mạng khác nhau có thể cần TURN. Chia sẻ màn hình trong kênh nhóm chưa được triển khai.

### Development build trên điện thoại Android thật

`Frontend/eas.json` có profile `development` tạo APK riêng chứa `expo-dev-client`. Chạy trong thư mục `Frontend`:

```powershell
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile development
```

EAS sẽ yêu cầu liên kết/tạo dự án Expo và cấu hình khóa ký nếu đây là lần build đầu. Sau khi build thành công, tải APK từ trang kết quả trên điện thoại và cài app Nagomi. Đóng Metro cũ, chạy `npm run start:dev` rồi mở bằng app Nagomi vừa cài, không mở bằng Expo Go. Chỉ đổi chế độ Metro sang dev-client không tự tạo hoặc cài APK.

Kênh thoại trên Expo Go hiện là giao diện xem trước: chỉ hiển thị avatar của bạn, không tham gia phòng thật và không có âm thanh. Kênh thoại trên development build và trình duyệt hỗ trợ WebRTC có luồng micro/camera; trạng thái bật/tắt được đồng bộ qua STOMP. Web không có API media phù hợp sẽ hiển thị hướng dẫn dùng localhost/HTTPS. Màn hình `VideoCall` riêng dành cho gọi video 1-1. Cấu hình APK chưa thay thế việc kiểm tra build native thành công và thử bằng hai tài khoản trên hai thiết bị.

### Windows Firewall khi thử bằng điện thoại

Giữ tường lửa bật. Nếu dùng Wi-Fi nhà hoặc mạng tin cậy, mở **PowerShell bằng Run as administrator** và chạy một lần. Đổi `Wi-Fi` nếu card mạng trên máy có tên khác:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private

if (-not (Get-NetFirewallRule -Name "Nagomi-Dev-LAN" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name "Nagomi-Dev-LAN" -DisplayName "Nagomi - Metro va Backend trong Wi-Fi" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080,8081 -Profile Private -InterfaceAlias "Wi-Fi" -RemoteAddress LocalSubnet
}

Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled True
```

Quy tắc chỉ cho các thiết bị cùng subnet truy cập cổng backend `8080` và Metro `8081` trên card Wi-Fi ở chế độ Private. Không chuyển Wi-Fi công cộng/không tin cậy thành Private; trong trường hợp đó có thể thử `npx expo start --go --tunnel` để tải app, nhưng tunnel Metro không cung cấp đường truy cập backend.

Khi Metro đang chạy, mở `http://<IP-Wi-Fi-may-tinh>:8081/status` trên điện thoại; kết quả đúng là `packager-status:running`. IP backend trong `Frontend/src/utils/constants.js` phải khớp IP Wi-Fi hiện tại. Để gỡ quy tắc khi không cần nữa, dùng `Remove-NetFirewallRule -Name "Nagomi-Dev-LAN"` trong PowerShell quản trị.

### Backend

Backend yêu cầu Java 21, Maven và một dự án Firebase đã tạo cơ sở dữ liệu Cloud Firestore (bản mặc định). Đặt biến `FIREBASE_PROJECT_ID` và cấu hình Application Default Credentials trước khi khởi chạy. Trên Windows PowerShell, ví dụ:

```powershell
$env:FIREBASE_PROJECT_ID = "your-firebase-project-id"
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
```

Tạo khóa service account trong Firebase Console > Project settings > Service accounts và giữ tệp khóa ngoài mã nguồn. Có thể dùng `gcloud auth application-default login` thay cho khóa service account khi phát triển cục bộ. Firebase Admin SDK dùng Application Default Credentials để xác thực với dự án Firebase.

Backend hiện ghi dữ liệu mới vào các collection Firestore như `users`, `servers`, `server_members`, `channels`, `channel_messages` và `private_messages`. Dữ liệu đang có trong MySQL không được tự động sao chép sang Firestore.

```bash
cd Backend
./mvnw spring-boot:run
```

Trên Windows có thể dùng `mvnw.cmd spring-boot:run`.

## Cấu hình

- Cấu hình địa chỉ API và WebSocket của frontend trong `Frontend/src/utils/constants.js`.
- Cấu hình Firebase Project ID và các thuộc tính Spring trong `Backend/src/main/resources/application.properties`.
- Không đưa mật khẩu, khóa JWT hoặc thông tin nhạy cảm vào mã nguồn hay tài liệu công khai.

## Trạng thái

Repo hiện có các thành phần frontend và backend cùng các luồng chức năng chính cho tài khoản, bạn bè, server, nhắn tin và thoại. Hãy xem mã nguồn và cấu hình môi trường hiện tại để xác nhận tính năng cụ thể trước khi triển khai hoặc phát hành.
