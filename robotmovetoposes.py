import socket
import time
import json
import os
import sys

# Try to import msvcrt for Windows key detection
try:
    import msvcrt
    WINDOWS = True
except ImportError:
    WINDOWS = False
    print("⚠️  Non-Windows system, key detection may not work.")

# Robot configuration
ROBOT_IP = "192.168.1.20"
MOVE_PORT = 30002
ACCELERATION = 0.3
VELOCITY = 0.15
MOVE_WAIT_TIME = 2.0  # seconds

# JSON file path
JSON_PATH = r"C:\Users\Shivam\Downloads\CameraChessWeb-main2\CameraChessWeb-main\public\chessboard_poses.json"

class RobotController:
    def __init__(self, ip, port, poses):
        self.ip = ip
        self.port = port
        self.socket = None
        self.poses = poses
        self.running = True

    def connect(self):
        print(f"🔌 Connecting to robot at {self.ip}:{self.port}...")
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.settimeout(10)
            self.socket.connect((self.ip, self.port))
            print(f"✅ Connected to robot")
            self.send_command('textmsg("Python script connected")', wait_time=0.5)
            return True
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return False

    def send_command(self, cmd, wait_time=0.1):
        if not self.socket:
            print("❌ Not connected")
            return False
        try:
            self.socket.sendall((cmd + "\n").encode())
            time.sleep(wait_time)
            return True
        except Exception as e:
            print(f"❌ Command error: {e}")
            return False

    def move_to_pose(self, pose, name=""):
        if name:
            print(f"➡️  Moving to {name}...")
        cmd = f"movel(p[{pose['x']:.5f}, {pose['y']:.5f}, {pose['z']:.5f}, {pose['rx']:.5f}, {pose['ry']:.5f}, {pose['rz']:.5f}], a={ACCELERATION}, v={VELOCITY})"
        self.send_command(f'textmsg("Moving to {name}")', wait_time=0.1)
        self.send_command(cmd, wait_time=0.1)
        print(f"⏱️  Waiting {MOVE_WAIT_TIME}s...")
        time.sleep(MOVE_WAIT_TIME)
        print(f"✅ {name} reached")

    def check_keypress(self):
        if not WINDOWS:
            return None
        if msvcrt.kbhit():
            key = msvcrt.getch()
            try:
                if isinstance(key, bytes):
                    return key.decode("utf-8").lower()
                return str(key).lower()
            except:
                return None
        return None

    def interactive_loop(self):
        print("🤖 Interactive robot control")
        print("Press number keys to move to corners, 'h' for home, 'd' for drop, 'space' to STOP, 'q' to quit")
        print("="*50)
        
        while self.running:
            key = self.check_keypress()
            if key:
                if key == 'q':
                    print("🛑 Quitting...")
                    self.running = False
                elif key == ' ':
                    print("⚠️  SPACE pressed - EMERGENCY STOP!")
                    self.send_command("stopl(2.0)")  # gentle deceleration
                elif key == 'h' and 'home' in self.poses:
                    self.move_to_pose(self.poses['home'], "Home")
                elif key == 'd' and 'drop' in self.poses:
                    self.move_to_pose(self.poses['drop'], "Drop")
                elif key.isdigit():
                    idx = int(key) - 1
                    if 'corners' in self.poses and 0 <= idx < len(self.poses['corners']):
                        self.move_to_pose(self.poses['corners'][idx], f"Corner {key}")
                    else:
                        print(f"❌ Corner {key} not defined")
                else:
                    print(f"⚠️ Unknown key '{key}' pressed")
            time.sleep(0.05)


def load_poses(json_path):
    if not os.path.exists(json_path):
        print(f"❌ JSON file not found: {json_path}")
        sys.exit(1)
    with open(json_path, 'r') as f:
        poses = json.load(f)
    return poses

def main():
    poses = load_poses(JSON_PATH)
    controller = RobotController(ROBOT_IP, MOVE_PORT, poses)
    if controller.connect():
        controller.interactive_loop()
    if controller.socket:
        controller.socket.close()
        print("✅ Disconnected from robot")

if __name__ == "__main__":
    main()
