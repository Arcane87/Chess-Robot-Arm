import { useEffect, useState } from "react";
import { MEDIA_CONSTRAINTS } from "../../utils/constants";
import { CameraDevice } from "../../types";

const DeviceButton = ({ videoRef, onDeviceChange }: {videoRef: any, onDeviceChange?: (device: CameraDevice) => void }) => {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [device, setDevice] = useState<CameraDevice | null>(null);

  const handleClick = async (e: any, newDevice: CameraDevice) => {
    e.preventDefault();

    if (device?.deviceId === newDevice.deviceId) {
      return;
    }

    setDevice(newDevice);
    
    if (onDeviceChange) {
      onDeviceChange(newDevice);
    }

    if (newDevice.type === 'droidcam') {
      // For DroidCam, we don't set srcObject
      // The Video component will handle this based on deviceType
      return;
    }

    const constraints: any = {...MEDIA_CONSTRAINTS}
    constraints["video"]["deviceId"] = newDevice.deviceId
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoRef.current.srcObject = stream;
  }

  useEffect(() => {
    const newDevices: CameraDevice[] = [];
    
    // Add DroidCam as a virtual device
    const droidcamDevice: CameraDevice = {
      deviceId: 'droidcam',
      kind: 'videoinput',
      label: 'DroidCam (iPhone)',
      type: 'droidcam'
    };
    newDevices.push(droidcamDevice);
    
    // Add real webcams
    navigator.mediaDevices
    .enumerateDevices()
    .then((devices) => {
      devices.forEach((device: MediaDeviceInfo) => {
        if (device.kind != "videoinput") {
          return;
        }
        newDevices.push({
          deviceId: device.deviceId,
          kind: device.kind,
          label: device.label,
          type: 'webcam'
        });
      });
      setDevices(newDevices);
    })
    .catch((err) => {
      console.error(`${err.name}: ${err.message}`);
      setDevices(newDevices); // Still include DroidCam even if webcams fail
    });
  }, [])

  return (
    <div className="dropdown">
      <button className="btn btn-dark btn-sm btn-outline-light dropdown-toggle w-100" id="deviceButton" data-bs-toggle="dropdown" aria-expanded="false">
      {(device === null) ? "Select a Device" : `Device: ${device.label}`}
      </button>
      <ul className="dropdown-menu" aria-labelledby="deviceButton">
        {devices.map(device => 
          <li key={device.deviceId}>
            <a onClick={(e) => handleClick(e, device)} className="dropdown-item" href="#">
              {device.label}
            </a>
          </li>
        )}
      </ul>
    </div>
  );
};

export default DeviceButton;