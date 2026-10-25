const fs = require("fs");
const path = require("path");
const { withAppBuildGradle, withDangerousMod, withProjectBuildGradle } = require("@expo/config-plugins");

const STL_CMAKE = `function(link_cpp_shared dir)
  get_property(targets DIRECTORY "\${dir}" PROPERTY BUILDSYSTEM_TARGETS)
  foreach(target IN LISTS targets)
    get_target_property(type \${target} TYPE)
    if(type STREQUAL "SHARED_LIBRARY")
      target_link_libraries(\${target} PRIVATE -lc++_shared)
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
// NDK 27 does not put libc++ on the link line for c++_shared.
subprojects { sub ->
  def hook = {
    def androidExt = sub.extensions.findByName("android")
    if (androidExt?.externalNativeBuild?.cmake?.path) {
      def args = androidExt.defaultConfig.externalNativeBuild.cmake.arguments
      def flag = "-DCMAKE_PROJECT_INCLUDE=\${rootDir}/stl.cmake".replace("\\\\", "/")
      if (!args.any { it.startsWith("-DCMAKE_PROJECT_INCLUDE=") }) {
        args.add(flag)
      }
    }
  }
  if (sub.state.executed) {
    hook()
  } else {
    sub.afterEvaluate hook
  }
}
`;

const CMAKE = `cmake_minimum_required(VERSION 3.13)
project(appmodules)
include(\${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
target_link_libraries(appmodules -lc++_shared)
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
    config.modResults.contents += ROOT_GRADLE;
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
