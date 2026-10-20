// Expo writes expo-env.d.ts locally (git-ignored); this committed copy of its one reference lets a
// clean checkout (CI) typecheck too, e.g. the side-effect import of @/global.css.
/// <reference types="expo/types" />
