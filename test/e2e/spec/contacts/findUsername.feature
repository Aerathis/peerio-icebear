Feature: Find contacts
    @confirmedUser
    Scenario: Find contact by username
        Given I am logged in
        When I search for a registered username
        And  the contact exists
        Then the contact is added in my contacts