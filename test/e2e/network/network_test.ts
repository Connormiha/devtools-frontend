// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {assert} from 'chai';

import {$textContent, goTo, reloadDevTools, typeText, waitFor} from '../../shared/helper.js';
import {describe, it} from '../../shared/mocha-extensions.js';
import {getAllRequestNames, getSelectedRequestName, navigateToNetworkTab, selectRequestByName, togglePersistLog, waitForSelectedRequestChange, waitForSomeRequestsToAppear} from '../helpers/network-helpers.js';

const SIMPLE_PAGE_REQUEST_NUMBER = 10;
const SIMPLE_PAGE_URL = `requests.html?num=${SIMPLE_PAGE_REQUEST_NUMBER}`;

async function getCategoryXHRFilter() {
  const filters = await waitFor('.filter-bitset-filter');
  const categoryXHRFilter = await $textContent('Fetch/XHR', filters);
  if (!categoryXHRFilter) {
    assert.fail('Could not find category XHR filter to click.');
  }
  return categoryXHRFilter;
}

describe('The Network Tab', async function() {
  // The tests here tend to take time because they wait for requests to appear in the request panel.
  this.timeout(5000);

  // Flakey test
  it.skip('[crbug.com/1093287] displays requests', async () => {
    await navigateToNetworkTab(SIMPLE_PAGE_URL);

    // Wait for all the requests to be displayed + 1 to account for the page itself.
    await waitForSomeRequestsToAppear(SIMPLE_PAGE_REQUEST_NUMBER + 1);

    const expectedNames = [SIMPLE_PAGE_URL];
    for (let i = 0; i < SIMPLE_PAGE_REQUEST_NUMBER; i++) {
      expectedNames.push(`image.svg?id=${i}`);
    }

    const names = await getAllRequestNames();
    assert.deepStrictEqual(names, expectedNames, 'The right request names should appear in the list');
  });

  // Flakey test
  it.skip('[crbug.com/1093287] can select requests', async () => {
    await navigateToNetworkTab(SIMPLE_PAGE_URL);

    let selected = await getSelectedRequestName();
    assert.isUndefined(selected, 'No request should be selected by default');

    await selectRequestByName(SIMPLE_PAGE_URL);
    await waitForSelectedRequestChange(selected);

    selected = await getSelectedRequestName();
    assert.strictEqual(selected, SIMPLE_PAGE_URL, 'Selecting the first request should work');

    const lastRequestName = `image.svg?id=${SIMPLE_PAGE_REQUEST_NUMBER - 1}`;
    await selectRequestByName(lastRequestName);
    await waitForSelectedRequestChange(selected);

    selected = await getSelectedRequestName();
    assert.strictEqual(selected, lastRequestName, 'Selecting the last request should work');
  });

  // Flakey test
  it.skip('[crbug.com/1093287] can persist requests', async () => {
    await navigateToNetworkTab(SIMPLE_PAGE_URL);

    // Wait for all the requests to be displayed + 1 to account for the page itself, and get their names.
    await waitForSomeRequestsToAppear(SIMPLE_PAGE_REQUEST_NUMBER + 1);
    const firstPageRequestNames = await getAllRequestNames();

    await togglePersistLog();

    // Navigate to a new page, and wait for the same requests to still be there.
    await goTo('about:blank');
    await waitForSomeRequestsToAppear(SIMPLE_PAGE_REQUEST_NUMBER + 1);
    const secondPageRequestNames = await getAllRequestNames();

    assert.deepStrictEqual(secondPageRequestNames, firstPageRequestNames, 'The requests were persisted');
  });

  it('persists filters across a reload', async () => {
    await navigateToNetworkTab(SIMPLE_PAGE_URL);
    let filterInput = await waitFor('.filter-input-field.text-prompt');
    filterInput.focus();
    await typeText('foo');
    let categoryXHRFilter = await getCategoryXHRFilter();
    await categoryXHRFilter.click();

    await reloadDevTools({selectedPanel: {name: 'network'}});
    filterInput = await waitFor('.filter-input-field.text-prompt');
    const filterText = await filterInput.evaluate(x => (x as HTMLElement).innerText);
    assert.strictEqual(filterText, 'foo');

    categoryXHRFilter = await getCategoryXHRFilter();
    const xhrHasSelectedClass = await categoryXHRFilter.evaluate(x => x.classList.contains('selected'));
    assert.isTrue(xhrHasSelectedClass);
  });
});
