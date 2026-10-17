// Expo Go on Android does not include expo-notifications' topic-subscription native module, and
// expo-notifications 57.0.23 loads it eagerly, so importing the library crashes every route.
// Load it optionally instead; subscribeToTopicAsync then throws UnavailabilityError (we don't use it).
import { requireOptionalNativeModule } from 'expo-modules-core';

export default requireOptionalNativeModule('ExpoTopicSubscriptionModule') ?? {};
