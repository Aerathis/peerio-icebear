@fileStoreLoaded
Feature: Files in storage
    Scenario: Download a file
        Given I am logged in
        Given I upload a file
        When  I download the file
        Then  I can access the file locally