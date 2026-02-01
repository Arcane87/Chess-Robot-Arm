import cv2

cap = cv2.VideoCapture("http://localhost:8080/video")

while True:
    ret, frame = cap.read()
    if not ret:
        break
    cv2.imshow("MJPEG Stream", frame)
    if cv2.waitKey(1) & 0xFF == 27:
        break

cap.release()
cv2.destroyAllWindows()
