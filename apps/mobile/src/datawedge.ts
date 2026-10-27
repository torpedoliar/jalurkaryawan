import { requireOptionalNativeModule } from "expo-modules-core";

type Subscription = { remove(): void };
type DataWedge = { start(): Promise<void>; stop(): Promise<void>; addListener(event: "onScan", listener: (event: { data: string }) => void): Subscription };
export const dataWedge = requireOptionalNativeModule<DataWedge>("BmsDataWedge");
