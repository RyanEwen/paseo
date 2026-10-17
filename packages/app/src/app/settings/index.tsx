import { Redirect } from "expo-router";
import { useIsCompactFormFactor } from "@/constants/layout";
import SettingsScreen from "@/screens/settings-screen";
import { buildDefaultSettingsRoute } from "@/utils/host-routes";

const ROOT_VIEW = { kind: "root" as const };

export default function SettingsIndexRoute() {
  const isCompactLayout = useIsCompactFormFactor();

  if (!isCompactLayout) {
    return <Redirect href={buildDefaultSettingsRoute()} />;
  }

  return <SettingsScreen view={ROOT_VIEW} />;
}
