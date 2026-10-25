import { requireOptionalNativeModule } from "expo";

export type ShareStackHit = {
  id: string;
  label: string;
  packageName: string;
  appName: string;
};

export type PanelHardwareProbe = {
  manufacturer: string;
  brand: string;
  model: string;
  device: string;
  release: string;
  sdk: number;
  features: {
    wifi: boolean;
    wifiDirect: boolean;
    wifiAware: boolean;
    bluetooth: boolean;
    bluetoothLe: boolean;
  };
  playServices: boolean;
  stacks: {
    googleCast: ShareStackHit[];
    miracast: ShareStackHit[];
    airplay: ShareStackHit[];
    mirroring: ShareStackHit[];
  };
  note: string;
};

type NativePanelHardware = {
  probeShareHardware(): PanelHardwareProbe;
};

const native = requireOptionalNativeModule<NativePanelHardware>("PanelHardware");

export function probeShareHardware(): PanelHardwareProbe | null {
  if (!native?.probeShareHardware) return null;
  try {
    return native.probeShareHardware();
  } catch {
    return null;
  }
}
