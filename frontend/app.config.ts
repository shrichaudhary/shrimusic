import appJson from "./app.json";

export default ({ config }: { config: typeof appJson.expo }) => ({
  ...config,
  extra: {
    backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL,
  },
});