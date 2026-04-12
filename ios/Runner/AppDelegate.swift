import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterStreamHandler {
  private let methodChannelName = "ai_vision_traffic_scanner/inference"
  private let eventChannelName = "ai_vision_traffic_scanner/inference_stream"
  private var eventSink: FlutterEventSink?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let controller = window?.rootViewController as! FlutterViewController

    let methodChannel = FlutterMethodChannel(
      name: methodChannelName,
      binaryMessenger: controller.binaryMessenger
    )
    methodChannel.setMethodCallHandler(handleMethodCall)

    let eventChannel = FlutterEventChannel(
      name: eventChannelName,
      binaryMessenger: controller.binaryMessenger
    )
    eventChannel.setStreamHandler(self)

    GeneratedPluginRegistrant.register(with: self)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func handleMethodCall(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "loadModel":
      // TODO: Load the exported YOLO ONNX model with ONNX Runtime Mobile.
      result(nil)
    case "startLiveInference":
      // TODO: Stream AVCapture frames through the detector and emit events.
      result(nil)
    case "analyzeVideoFile":
      // TODO: Read local video frames, run inference, and emit events.
      result(nil)
    case "stopInference":
      // TODO: Stop native inference and release resources.
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    eventSink = events
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    eventSink = nil
    return nil
  }
}
