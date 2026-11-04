"use strict";

module.exports = {
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    url: "http://localhost/fortiedrCommandTimeline-dev/",
  },
  testMatch: ["<rootDir>/tests/**/*.test.js"],
};
