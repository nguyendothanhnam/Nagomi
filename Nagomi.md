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
npx expo start
```

Có thể mở ứng dụng bằng Expo Go, Android Emulator hoặc iOS Simulator tùy cấu hình môi trường.

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
