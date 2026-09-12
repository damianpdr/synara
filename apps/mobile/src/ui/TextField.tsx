// FILE: TextField.tsx
// Purpose: Labelled text input with inline validation copy.
// Layer: Mobile UI
// Exports: TextField.

import { forwardRef } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { Text } from "@/ui/Text";
import { useTheme } from "@/ui/ThemeProvider";

export interface TextFieldProps extends TextInputProps {
  readonly label?: string;
  readonly hint?: string;
  readonly error?: string | null;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, style, ...rest },
  ref,
) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs + 2 }}>
      {label ? (
        <Text variant="label" color="tertiary" uppercase>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={theme.colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
        style={[
          styles.input,
          theme.typography.callout,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceSunken,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="footnote" color="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" color="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth },
});
