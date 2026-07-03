import { useStore } from '@nanostores/react';
import { Redirect } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { $connection } from '@/store/connection';

export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const connection = useStore($connection);

  if (connection.phase === 'login_required') {
    return <Redirect href="/login" />;
  }
  if (connection.phase !== 'connected' && connection.phase !== 'connecting') {
    return <Redirect href="/connect" />;
  }

  return (
    <NativeTabs backgroundColor={colors.background} indicatorColor={colors.backgroundElement}>
      <NativeTabs.Trigger name="index">
        <Label>Chat</Label>
        <Icon sf="bubble.left.and.bubble.right" src={require('@/assets/images/tabIcons/home.png')} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="code">
        <Label>Code</Label>
        <Icon sf="chevron.left.forwardslash.chevron.right" src={require('@/assets/images/tabIcons/explore.png')} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="projects">
        <Label>Projects</Label>
        <Icon sf="folder" src={require('@/assets/images/tabIcons/explore.png')} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
