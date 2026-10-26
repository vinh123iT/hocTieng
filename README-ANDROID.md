# PinkVocab – bản ứng dụng Android (APK)

Ứng dụng này là chính website PinkVocab được đóng gói bằng [Capacitor](https://capacitorjs.com/).
Toàn bộ giao diện nằm sẵn trong ứng dụng (thư mục `www`) nên **học được cả khi không có mạng và không cần hosting**.
Dữ liệu (học phần, tiến độ, danh sách nhạc...) lưu ngay trên điện thoại.

> Chỉ cài được trên **Android**. iPhone không dùng được tệp APK.

## Cách 1 – Build APK trên GitHub (không cần cài Android Studio)

1. Tạo tài khoản miễn phí ở github.com, tạo một kho mới (New repository), đặt tên tùy ý, chọn **Private** nếu muốn riêng tư.
2. Tải **toàn bộ nội dung** thư mục này lên kho đó (nút **Add file → Upload files**, kéo thả tất cả, trừ thư mục `node_modules` nếu có).
   Nhớ giữ nguyên thư mục `.github` và `android`. Nếu quen dùng git thì `git init`, `git add .`, `git commit`, `git push` lên nhánh `main`.
3. Vào tab **Actions** của kho → chọn **Build APK** → bấm **Run workflow**. Chờ khoảng 5–10 phút đến khi có dấu tích xanh.
   (Nếu đã đẩy code lên nhánh `main` thì nó tự chạy.)
4. Bấm vào lần chạy vừa xong, cuộn xuống mục **Artifacts**, tải **PinkVocab-apk** (tệp .zip), giải nén sẽ có `app-debug.apk`.
5. Chép `app-debug.apk` sang điện thoại (USB, Zalo, Google Drive...), mở tệp để cài.
   Android sẽ hỏi cho phép **cài ứng dụng từ nguồn không rõ**: bật cho ứng dụng bạn đang dùng để mở tệp (Chrome, Zalo, Tệp...). Nếu Play Protect cảnh báo, chọn **Cài đặt vẫn** (vì đây là ứng dụng do chính bạn tự build).

## Cách 2 – Build bằng Android Studio

1. Cài **Android Studio** (bản mới, đã kèm JDK 21).
2. Chọn **Open** và mở thư mục `android` trong dự án này. Chờ Gradle đồng bộ xong (lần đầu tải khá lâu).
3. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. Khi báo xong, bấm **locate**, hoặc mở `android/app/build/outputs/apk/debug/app-debug.apk`.
5. Chép sang điện thoại và cài như bước 5 ở trên. Cũng có thể cắm cáp USB (bật Gỡ lỗi USB) rồi bấm nút **Run ▶**.

## Khi website có thay đổi
Thay các tệp trong `www` bằng bản mới (hoặc nhờ Claude xuất lại), rồi build lại APK theo cách 1 hoặc 2.
Dữ liệu trên điện thoại được giữ nguyên nếu bạn cài đè lên bản cũ (không gỡ ứng dụng).

## Lưu ý
* Đây là APK **debug** để dùng cá nhân. Muốn đưa lên Google Play cần ký bản release (chưa làm trong gói này).
* Dữ liệu chỉ nằm trên điện thoại: **gỡ ứng dụng hoặc xóa dữ liệu ứng dụng là mất** và không đồng bộ với laptop.
* Nhạc YouTube/SoundCloud cần có mạng. Khi thoát ứng dụng hoặc tắt màn hình, nhạc có thể bị Android tạm dừng.
* Giọng đọc từ vựng dùng bộ đọc của hệ thống Android. Nếu điện thoại không đọc được, hãy cài/bật "Dịch vụ chuyển văn bản thành giọng nói của Google" trong Cài đặt.
