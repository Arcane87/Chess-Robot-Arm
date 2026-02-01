import socket
import time
import sys
import math
import struct
import threading

# Robot configuration
ROBOT_IP = "192.168.1.20"
MOVE_PORT = 30002
STATE_PORT = 30003

# Tool positions in meters and radians
A1 = {'x': 0.225, 'y': 0.139, 'z': 0.204, 'rx': 2.205, 'ry': -2.277, 'rz': 0.016}
H1 = {'x': 0.24130, 'y': -0.05621, 'z': 0.20399, 'rx': 2.205, 'ry': -2.277, 'rz': 0.016}
H8 = {'x': 0.43138, 'y': -0.05222, 'z': 0.20400, 'rx': 2.205, 'ry': -2.277, 'rz': 0.016}
A8 = {'x': 0.43138, 'y': 0.13319, 'z': 0.20399, 'rx': 2.205, 'ry': -2.277, 'rz': 0.016}

# Movement parameters
ACCELERATION = 0.3
VELOCITY = 0.15

class ContinuousTCPReader:
    """
    Continuously reads TCP pose from robot state interface in a background thread.
    Properly handles UR packet structure with 4-byte header.
    """
    
    def __init__(self, robot_ip, state_port=30003):
        self.robot_ip = robot_ip
        self.state_port = state_port
        self.socket = None
        self.reading_thread = None
        self.running = False
        self.current_pose = None
        self.pose_lock = threading.Lock()
        self.connection_established = False
        self.tcp_data_offset = 444  # Your confirmed offset in the DATA part (without header)
        
    def connect(self):
        """Connect to robot state interface"""
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.settimeout(3.0)
            self.socket.connect((self.robot_ip, self.state_port))
            self.connection_established = True
            print(f"📊 Connected to state interface at {self.robot_ip}:{self.state_port}")
            return True
        except Exception as e:
            print(f"⚠️  State interface connection failed: {e}")
            return False
    
    def reading_thread_func(self):
        """Background thread that continuously reads state packets with proper header handling"""
        buffer = b''
        
        while self.running:
            try:
                # Read available data
                try:
                    chunk = self.socket.recv(4096)
                    if chunk:
                        buffer += chunk
                except BlockingIOError:
                    # No data available yet
                    time.sleep(0.001)
                    continue
                
                # Process complete packets from buffer
                while len(buffer) >= 4:  # Need at least header
                    # Extract packet size from header (4 bytes, big-endian)
                    packet_size = struct.unpack('>I', buffer[0:4])[0]
                    
                    # Check if we have a complete packet
                    if len(buffer) >= packet_size:
                        # Extract the complete packet
                        packet = buffer[0:packet_size]
                        buffer = buffer[packet_size:]  # Remove processed packet
                        
                        # The TCP pose is at offset 444 in the DATA part
                        # The packet has: [4-byte header][data...]
                        # So TCP pose in full packet is at: 4 (header) + 444 = 448
                        tcp_offset_in_packet = 4 + self.tcp_data_offset
                        
                        if packet_size >= tcp_offset_in_packet + 48:
                            try:
                                # Extract TCP pose (6 doubles: X, Y, Z, Rx, Ry, Rz)
                                pose_data = struct.unpack('!6d', 
                                    packet[tcp_offset_in_packet:tcp_offset_in_packet+48])
                                x, y, z, rx, ry, rz = pose_data
                                
                                # Sanity checks - updated for moving robot
                                if (abs(x) < 2.0 and abs(y) < 2.0 and 0.0 < z < 2.0 and
                                    abs(rx) < 10.0 and abs(ry) < 10.0 and abs(rz) < 10.0):
                                    
                                    pose = {'x': x, 'y': y, 'z': z, 'rx': rx, 'ry': ry, 'rz': rz}
                                    with self.pose_lock:
                                        old_pose = self.current_pose
                                        self.current_pose = pose
                                        
                                        # Log when pose actually changes
                                        if old_pose:
                                            dx = abs(pose['x'] - old_pose['x'])
                                            dy = abs(pose['y'] - old_pose['y'])
                                            dz = abs(pose['z'] - old_pose['z'])
                                            if dx > 0.001 or dy > 0.001 or dz > 0.001:
                                                # Pose changed significantly
                                                pass
                            
                            except struct.error:
                                # Malformed packet, skip
                                pass
                    else:
                        # Incomplete packet, wait for more data
                        break
                
            except ConnectionResetError:
                print("⚠️  State connection reset")
                break
            except Exception as e:
                # Suppress common errors to keep thread running
                if "timed out" not in str(e):
                    print(f"⚠️  Read error in state thread: {e}")
                time.sleep(0.01)
        
        print("📊 State reading thread stopped")
    
    def start(self):
        """Start the continuous reading thread"""
        if not self.connect():
            return False
        
        # Set socket to non-blocking for the reading thread
        self.socket.setblocking(False)
        
        self.running = True
        self.reading_thread = threading.Thread(target=self.reading_thread_func, daemon=True)
        self.reading_thread.start()
        
        # Wait for first reading
        for i in range(30):  # Wait up to 3 seconds
            if self.get_current_pose():
                break
            time.sleep(0.1)
        
        return True
    
    def get_current_pose(self):
        """Get the latest TCP pose (thread-safe)"""
        with self.pose_lock:
            return self.current_pose
    
    def stop(self):
        """Stop the reading thread"""
        self.running = False
        if self.reading_thread and self.reading_thread.is_alive():
            self.reading_thread.join(timeout=1.0)
        if self.socket:
            self.socket.close()

class RobotController:
    def __init__(self, ip, move_port, state_port=30003):
        self.ip = ip
        self.move_port = move_port
        self.state_port = state_port
        self.move_socket = None
        self.tcp_reader = None
        self.running = False
        
    def connect(self):
        """Establish connections to robot"""
        print(f"🔌 Connecting to robot at {self.ip}...")
        
        # Connect to command interface
        try:
            self.move_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.move_socket.settimeout(10)
            self.move_socket.connect((self.ip, self.move_port))
            print(f"✅ Connected to command interface at {self.ip}:{self.move_port}")
        except Exception as e:
            print(f"❌ Command interface failed: {e}")
            return False
        
        # Start continuous TCP reader with proper packet handling
        self.tcp_reader = ContinuousTCPReader(self.ip, self.state_port)
        if self.tcp_reader.start():
            print("📊 Continuous TCP reader started (with proper packet handling)")
            
            # Display initial pose
            initial_pose = self.tcp_reader.get_current_pose()
            if initial_pose:
                print(f"📊 Initial pose: X={initial_pose['x']*1000:.1f}mm, "
                      f"Y={initial_pose['y']*1000:.1f}mm, "
                      f"Z={initial_pose['z']*1000:.1f}mm")
            else:
                print("⚠️  No initial pose received")
        else:
            print("⚠️  Could not start TCP reader")
        
        return True
    
    def send_command(self, cmd, wait_time=0.1):
        """Send command to robot"""
        if not self.move_socket:
            return False
            
        try:
            self.move_socket.sendall((cmd + "\n").encode())
            time.sleep(wait_time)
            return True
        except Exception as e:
            print(f"❌ Command failed: {e}")
            return False
    
    def get_current_tcp_pose(self):
        """Get current TCP pose from continuous reader"""
        if self.tcp_reader:
            return self.tcp_reader.get_current_pose()
        return None
    
    def move_with_live_verification(self, target_pose, pose_name=""):
        """
        Move with live TCP reading that should now update as robot moves
        """
        print(f"\n📍 {pose_name}")
        print(f"  Target: X={target_pose['x']*1000:.1f}mm, "
              f"Y={target_pose['y']*1000:.1f}mm, "
              f"Z={target_pose['z']*1000:.1f}mm")
        
        # Get starting pose
        start_pose = self.get_current_tcp_pose()
        if start_pose:
            print(f"  Start:  X={start_pose['x']*1000:.1f}mm, "
                  f"Y={start_pose['y']*1000:.1f}mm, "
                  f"Z={start_pose['z']*1000:.1f}mm")
            
            # Calculate expected distance
            dx = target_pose['x'] - start_pose['x']
            dy = target_pose['y'] - start_pose['y']
            dz = target_pose['z'] - start_pose['z']
            distance = math.sqrt(dx*dx + dy*dy + dz*dz)
            print(f"  Distance: {distance*1000:.1f}mm")
        
        # Send movement command
        cmd = f"movel(p[{target_pose['x']:.5f}, {target_pose['y']:.5f}, {target_pose['z']:.5f}, " \
              f"{target_pose['rx']:.5f}, {target_pose['ry']:.5f}, {target_pose['rz']:.5f}], " \
              f"a={ACCELERATION}, v={VELOCITY})"
        
        print(f"  📤 Sending movement command...")
        
        if not self.send_command(cmd, wait_time=0.1):
            print(f"  ❌ Failed to send command")
            return False
        
        # Monitor movement with live TCP reading
        print(f"  👀 Monitoring movement with live TCP reading...")
        
        start_time = time.time()
        timeout = 10.0  # Generous timeout
        last_pose = start_pose
        last_print = start_time
        
        while time.time() - start_time < timeout:
            # Get current pose
            current_pose = self.get_current_tcp_pose()
            
            if current_pose:
                # Check if pose is updating
                if last_pose:
                    dx_change = abs(current_pose['x'] - last_pose['x'])
                    dy_change = abs(current_pose['y'] - last_pose['y'])
                    dz_change = abs(current_pose['z'] - last_pose['z'])
                    
                    # If pose changed significantly, robot is moving
                    if dx_change > 0.001 or dy_change > 0.001 or dz_change > 0.001:
                        print(f"  ✅ TCP READING IS UPDATING! Robot is moving.")
                        print(f"    Current: X={current_pose['x']*1000:.1f}mm, "
                              f"Y={current_pose['y']*1000:.1f}mm, "
                              f"Z={current_pose['z']*1000:.1f}mm")
                
                last_pose = current_pose
                
                # Calculate distance to target
                dx = target_pose['x'] - current_pose['x']
                dy = target_pose['y'] - current_pose['y']
                dz = target_pose['z'] - current_pose['z']
                current_distance = math.sqrt(dx*dx + dy*dy + dz*dz)
                
                # Print progress every 0.5 seconds
                if time.time() - last_print > 0.5:
                    print(f"    📍 Remaining: {current_distance*1000:.1f}mm")
                    last_print = time.time()
                
                # Check if we've reached target
                if current_distance < 0.005:  # 5mm tolerance
                    elapsed = time.time() - start_time
                    print(f"  ✅ Reached {pose_name} in {elapsed:.1f}s")
                    print(f"    Final: X={current_pose['x']*1000:.1f}mm, "
                          f"Y={current_pose['y']*1000:.1f}mm, "
                          f"Z={current_pose['z']*1000:.1f}mm")
                    return True
            
            time.sleep(0.05)  # 50ms polling
        
        # Timeout reached
        final_pose = self.get_current_tcp_pose()
        if final_pose:
            print(f"  ⚠️  Timeout. Final pose: X={final_pose['x']*1000:.1f}mm, "
                  f"Y={final_pose['y']*1000:.1f}mm, "
                  f"Z={final_pose['z']*1000:.1f}mm")
        else:
            print(f"  ⚠️  Timeout. No TCP reading available.")
        
        return False
    
    def test_tcp_reading_during_movement(self):
        """Test TCP reading while robot moves"""
        print("\n" + "="*70)
        print("🎯 TESTING TCP READING DURING MOVEMENT")
        print("="*70)
        print("This test will:")
        print("1. Show current TCP pose")
        print("2. Move to H1 while monitoring TCP updates")
        print("3. Verify TCP reading tracks robot movement")
        print("="*70)
        
        # First, check current pose
        print("\n📊 Checking current TCP pose...")
        for i in range(5):
            pose = self.get_current_tcp_pose()
            if pose:
                print(f"  Reading {i+1}: X={pose['x']*1000:.1f}mm, "
                      f"Y={pose['y']*1000:.1f}mm, Z={pose['z']*1000:.1f}mm")
            else:
                print(f"  Reading {i+1}: No pose data")
            time.sleep(0.2)
        
        # Now move to H1 with live monitoring
        print(f"\n🚀 Moving to H1 with live TCP monitoring...")
        success = self.move_with_live_verification(H1, "H1")
        
        if success:
            print(f"\n✅ SUCCESS: TCP reading correctly tracked robot movement!")
        else:
            print(f"\n⚠️  TCP reading may not be updating correctly")
            
            # Check final pose
            final_pose = self.get_current_tcp_pose()
            if final_pose:
                print(f"📊 Final TCP reading: X={final_pose['x']*1000:.1f}mm, "
                      f"Y={final_pose['y']*1000:.1f}mm, Z={final_pose['z']*1000:.1f}mm")
            
            print(f"\n🔍 PROBLEM ANALYSIS:")
            print(f"  Robot IS moving (you can see it)")
            print(f"  But TCP reading is NOT updating")
            print(f"  This means the TCP reader still has issues")
        
        return success
    
    def run_complete_test(self):
        """Run complete test of TCP reading during movement"""
        if not self.connect():
            return
        
        print("\n" + "="*70)
        print("🤖 COMPLETE TCP READING TEST DURING MOVEMENT")
        print("="*70)
        
        try:
            self.running = True
            
            # Test 1: Basic TCP reading
            print("\n1️⃣  Testing TCP reading at rest...")
            for i in range(3):
                pose = self.get_current_tcp_pose()
                if pose:
                    print(f"   Reading {i+1}: X={pose['x']*1000:.1f}mm, "
                          f"Y={pose['y']*1000:.1f}mm, Z={pose['z']*1000:.1f}mm")
                time.sleep(0.3)
            
            # Test 2: Move to H1 with monitoring
            print("\n2️⃣  Moving to H1 with TCP monitoring...")
            self.move_with_live_verification(H1, "H1")
            time.sleep(0.5)
            
            # Test 3: Move to H8
            print("\n3️⃣  Moving to H8 with TCP monitoring...")
            self.move_with_live_verification(H8, "H8")
            time.sleep(0.5)
            
            # Test 4: Move to A8
            print("\n4️⃣  Moving to A8 with TCP monitoring...")
            self.move_with_live_verification(A8, "A8")
            time.sleep(0.5)
            
            # Test 5: Return to A1
            print("\n5️⃣  Returning to A1 with TCP monitoring...")
            self.move_with_live_verification(A1, "A1")
            
            print("\n" + "="*70)
            print("📊 TEST COMPLETE")
            print("="*70)
            print("If TCP readings updated during movement:")
            print("  ✅ TCP reader is WORKING correctly")
            print("If TCP readings stayed at A1:")
            print("  ❌ TCP reader still has packet sync issues")
            print("="*70)
            
        except KeyboardInterrupt:
            print("\n\n⚠️  Keyboard interrupt!")
            self.running = False
        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            print("\n" + "="*70)
            print("🧹 CLEANING UP...")
            
            try:
                self.send_command("stopl(2.0)")
                time.sleep(0.5)
            except:
                pass
            
            if self.tcp_reader:
                self.tcp_reader.stop()
            
            if self.move_socket:
                self.move_socket.close()
                print("✅ Disconnected")
            
            print("\n👋 TEST COMPLETE")
            print("="*70)

def main():
    print("="*70)
    print("🔧 FIXED TCP READER TEST - WITH PROPER PACKET HANDLING")
    print("="*70)
    print("Key fix: Properly handles UR packet structure:")
    print("  • 4-byte header containing packet size")
    print("  • TCP pose at offset 444 in DATA part (448 in full packet)")
    print("  • Non-blocking continuous reading")
    print("="*70)
    
    controller = RobotController(ROBOT_IP, MOVE_PORT, STATE_PORT)
    controller.run_complete_test()

if __name__ == "__main__":
    main()