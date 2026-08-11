import { Platform, type TextStyle, type ViewStyle } from "react-native";

const ios = Platform.OS === "ios";

// pick(iosValue, androidValue): iOS gets the polished value; Android keeps today's.
const p = <T,>(iosV: T, androidV: T): T => (ios ? iosV : androidV);

const color = {
  ground: "#050508",
  surface: p("#0d0b14", "#12100c"),
  surfaceRaised: p("#14111d", "#171310"),
  hairline: p("rgba(240,220,184,0.09)", "#3a3325"),
  textPrimary: p("#f0dcb8", "#d9c9a8"),
  textSecondary: p("#b0a898", "#c8c0b0"),
  textMuted: p("#6f6a62", "#8a7a5c"),
  label: "#9a875f",
  accent: "#b3746b",
  focusRing: "rgba(240,220,184,0.5)",
};

const type: Record<string, TextStyle> = {
  display: { fontSize: p(34, 40), fontWeight: "600", letterSpacing: -0.4 },
  title: { fontSize: 22, fontWeight: "600", letterSpacing: -0.2 },
  heading: { fontSize: 17, fontWeight: "500" },
  body: { fontSize: 16, fontWeight: "400" },
  bodySm: { fontSize: 15, fontWeight: "400" },
  label: { fontSize: 13, fontWeight: "500", letterSpacing: 0.2 },
  micro: { fontSize: 11, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase" },
};

const tabular: TextStyle = { fontVariant: ["tabular-nums"] };

const radius = { sm: 12, md: 16, pill: 999 };

const space = (n: number): number => n * 4;

const panel: ViewStyle = {
  backgroundColor: color.surface,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: color.hairline,
  padding: space(4),
  ...(ios
    ? { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }
    : null),
};

const t = { ios, color, type, tabular, radius, space, surface: { panel } };
export default t;
