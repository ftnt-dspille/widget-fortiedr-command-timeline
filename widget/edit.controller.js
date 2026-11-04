/* Copyright start
   MIT License
   Copyright (c) 2026 Your Team
   Copyright end */
"use strict";
// EDIT controller -- the config editor. The SOAR shell opens it as a $uibModal,
// so save() must close with the config and cancel() must dismiss.
(function () {
  angular
    .module("cybersponse")
    .controller("editFortiedrCommandTimeline101DevCtrl", editFortiedrCommandTimeline101DevCtrl);

  // `config` is the SAVED config, injected -- not handed over on $scope. Without
  // it the editor shows stale defaults every time it reopens and closes the
  // modal with a fresh object, silently discarding the user's saved choices.
  editFortiedrCommandTimeline101DevCtrl.$inject = ["$scope", "$uibModalInstance", "config"];

  function editFortiedrCommandTimeline101DevCtrl($scope, $uibModalInstance, config) {
    var defaults = {
      title: "FortiEDR Command Timeline",
      showModules: true
    };
    $scope.config = angular.extend({}, defaults, config || {}, $scope.config || {});

    // Closing the modal is NOT one contract -- it is four, and which one is
    // live depends on the host. Injected $uibModalInstance is the documented
    // path and the only one the harness provides; the dashboard/template
    // editor instead exposes $close/$dismiss straight on this scope, and some
    // hosts hand down a closeSettings() on a parent. Try every path.
    function closeModal(result, dismiss) {
      if ($uibModalInstance) {
        if (dismiss) { $uibModalInstance.dismiss("cancel"); }
        else { $uibModalInstance.close(result); }
        return true;
      }
      if (typeof $scope.$dismiss === "function" && dismiss) { $scope.$dismiss("cancel"); return true; }
      if (typeof $scope.$close === "function" && !dismiss) { $scope.$close(result); return true; }
      for (var s = $scope; s; s = s.$parent) {
        if (typeof s.closeSettings === "function") { s.closeSettings(result); return true; }
      }
      // Last resort: let the host hear about it even if it gave us no handle.
      $scope.$emit(dismiss ? "widgetSettingsDismissed" : "widgetSettingsSaved", result);
      return false;
    }

    $scope.save = function () {
      return closeModal($scope.config, false);
    };
    $scope.cancel = function () {
      return closeModal(null, true);
    };
  }
})();
