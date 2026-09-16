/**
 * __mocks__/react-native-vision-camera.js
 *
 * vision-camera's native module (react-native-nitro-modules) only exists
 * after a real native build — there is no way to import the real package in
 * Jest, on any machine, not just this project's sandbox. This mock exists
 * purely so App.test.tsx's render smoke test can execute at all; it is not
 * a substitute for testing the camera itself, which can only happen on a
 * real device or emulator (see CaptureScreen.tsx's own header comment).
 */

module.exports = {
  Camera: () => null,
  useCameraDevice: () => ({ id: 'mock-front-camera', position: 'front' }),
  useCameraPermission: () => ({
    hasPermission: true,
    canRequestPermission: false,
    requestPermission: async () => true,
  }),
  usePhotoOutput: () => ({
    capturePhotoToFile: async () => ({ filePath: '/mock/frame.jpg' }),
  }),
};