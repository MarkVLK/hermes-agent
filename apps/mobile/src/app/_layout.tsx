import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { restoreConnection } from '@/store/connection';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [restored, setRestored] = useState(false);

  // Try the saved gateway before first paint so a configured phone goes
  // straight into Chat instead of bouncing through the connect screen.
  useEffect(() => {
    restoreConnection()
      .catch(() => {})
      .finally(() => {
        setRestored(true);
        SplashScreen.hideAsync();
      });
  }, []);

  if (!restored) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="connect" options={{ title: 'Connect to Hermes' }} />
        <Stack.Screen name="login" options={{ title: 'Sign in' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Stack.Screen name="file" options={{ title: 'File', presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}
