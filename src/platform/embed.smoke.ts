// TEMPORARY device probe for Task 3's link gate. Deleted in Task 4's commit.
//
// Proves that (a) onnxruntime-react-native links and installs its JSI API
// under the new architecture (bridgeless), and (b) the bundled MiniLM model
// asset can actually be turned into a live InferenceSession on device.
//
// The asset wrinkle: `require('../assets/minilm/model.onnx')` gives Metro's
// asset ref (a number), not a file path. InferenceSession.create needs a real
// path or the raw bytes. We resolve the asset to its URI (Metro dev-server URL
// in debug, packaged resource in release), fetch the bytes, and hand
// InferenceSession.create the Uint8Array — the 1.24 API accepts a buffer.
import { Image } from "react-native";
import { InferenceSession } from "onnxruntime-react-native";

export async function runOnnxSmoke(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const assetRef = require("../assets/minilm/model.onnx");
    const source = Image.resolveAssetSource(assetRef);
    console.log("onnx-smoke asset uri", source.uri);
    const res = await fetch(source.uri);
    const bytes = new Uint8Array(await res.arrayBuffer());
    console.log("onnx-smoke model bytes", bytes.byteLength);
    const session = await InferenceSession.create(bytes);
    console.log("onnx-smoke IN", session.inputNames, "OUT", session.outputNames);
  } catch (e) {
    console.log("onnx-smoke FAILED", String(e));
  }
}
