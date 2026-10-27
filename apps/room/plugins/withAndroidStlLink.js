const fs = require("fs");
const path = require("path");
const { withAppBuildGradle, withDangerousMod, withProjectBuildGradle } = require("@expo/config-plugins");

// Loaded via -DCMAKE_PROJECT_INCLUDE after each project's own arguments are set.
// project() runs before targets exist, so the link is deferred to the end of configure.
const STL_CMAKE = `function(link_cpp_shared dir)
  get_property(targets DIRECTORY "\${dir}" PROPERTY BUILDSYSTEM_TARGETS)
  foreach(target IN LISTS targets)
    get_target_property(type \${target} TYPE)
    get_target_property(imported \${target} IMPORTED)
    get_target_property(aliased \${target} ALIASED_TARGET)
    if(type STREQUAL "SHARED_LIBRARY" AND NOT imported AND NOT aliased)
      target_link_options(\${target} PRIVATE "-lc++_shared")
    endif()
  endforeach()
  get_property(subs DIRECTORY "\${dir}" PROPERTY SUBDIRECTORIES)
  foreach(sub IN LISTS subs)
    link_cpp_shared("\${sub}")
  endforeach()
endfunction()

cmake_language(DEFER DIRECTORY "\${CMAKE_SOURCE_DIR}" CALL link_cpp_shared "\${CMAKE_SOURCE_DIR}")
`;


const ROOT_GRADLE = `
// NDK 27 does not link libc++ into shared libraries. Registered before Expo
// evaluates projects and before each Android plugin snapshots CMake arguments.
subprojects { sub ->
  sub.afterEvaluate {
    def androidExt = sub.extensions.findByName("android")
    if (!androidExt?.externalNativeBuild?.cmake?.path) {
      return
    }
    def cmake = androidExt.defaultConfig.externalNativeBuild.cmake
    def flag = "-DCMAKE_PROJECT_INCLUDE=\${rootDir}/stl.cmake".replace("\\\\", "/")
    if (!cmake.arguments.any { it.startsWith("-DCMAKE_PROJECT_INCLUDE=") }) {
      cmake.arguments(flag)
    }
  }
}
`;

// NDK 27's legacy toolchain compiles with -stdlib=libc++ but does not link
// libc++_shared into autolinked shared libraries. CMake 3.22 does not add it
// either. Walk every shared library after autolinking and link c++_shared.
const CMAKE = `cmake_minimum_required(VERSION 3.13)
project(appmodules)
include(\${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

function(link_cpp_shared dir)
  get_property(targets DIRECTORY "\${dir}" PROPERTY BUILDSYSTEM_TARGETS)
  foreach(target IN LISTS targets)
    get_target_property(type \${target} TYPE)
    get_target_property(imported \${target} IMPORTED)
    get_target_property(aliased \${target} ALIASED_TARGET)
    if(type STREQUAL "SHARED_LIBRARY" AND NOT imported AND NOT aliased)
      target_link_libraries(\${target} c++_shared)
    endif()
  endforeach()
  get_property(subs DIRECTORY "\${dir}" PROPERTY SUBDIRECTORIES)
  foreach(sub IN LISTS subs)
    link_cpp_shared("\${sub}")
  endforeach()
endfunction()

link_cpp_shared("\${CMAKE_SOURCE_DIR}")
`;

function withAndroidStlLink(config) {
  config = withDangerousMod(config, [
    "android",
    (config) => {
      const root = config.modRequest.platformProjectRoot;
      const dir = path.join(root, "app", "src", "main", "jni");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "CMakeLists.txt"), CMAKE);
      fs.writeFileSync(path.join(root, "stl.cmake"), STL_CMAKE);
      return config;
    },
  ]);

  config = withProjectBuildGradle(config, (config) => {
    if (config.modResults.contents.includes("CMAKE_PROJECT_INCLUDE=")) return config;
    const anchor = 'apply plugin: "expo-root-project"';
    if (config.modResults.contents.includes(anchor)) {
      config.modResults.contents = config.modResults.contents.replace(anchor, `${ROOT_GRADLE}\n${anchor}`);
    } else {
      config.modResults.contents += ROOT_GRADLE;
    }
    return config;
  });

  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes('path "src/main/jni/CMakeLists.txt"')) return config;
    config.modResults.contents = config.modResults.contents.replace(
      /android \{\r?\n/,
      'android {\n    externalNativeBuild {\n        cmake {\n            path "src/main/jni/CMakeLists.txt"\n        }\n    }\n',
    );
    return config;
  });
}

module.exports = withAndroidStlLink;
