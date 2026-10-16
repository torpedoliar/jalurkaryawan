import { Text } from "react-native";
// Heading must not duplicate the "Papan Keberangkatan" tab label: tests use
// getByText("Papan Keberangkatan") and duplicates would fail the query.
export function Departures() { return <Text accessibilityRole="header">Keberangkatan</Text>; }
