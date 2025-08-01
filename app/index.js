// libs for github & graphql
const core = require('@actions/core');
const github = require('@actions/github');
const { parse } = require('json2csv');

// libs for csv file creation
const { dirname } = require("path");
const makeDir = require("make-dir");

// get the octokit handle
const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const octokit = github.getOctokit(GITHUB_TOKEN);

// inputs defined in action metadata file
const org_Name = core.getInput('org_name');
const repo_Name = core.getInput('repo_name');
const csv_path = core.getInput('csv_path');

// Graphql query for vulnerability data
const query =
  `query ($org_name: String! $repo_name: String! $pagination: String){
      repository(owner: $org_name name: $repo_name) {
        name
        vulnerabilityAlerts(first: 50 after: $pagination) {
          pageInfo {
              hasNextPage
              endCursor
          }
          totalCount
          nodes {
            id
            number
            createdAt
            state
            dismissedAt
            dismissReason
            dismissComment
            fixedAt
            dependencyScope
            repository{
              name
              owner{
                login
              }
            }
            securityAdvisory {
                ghsaId
                description
                permalink
                severity
                summary
            }
            securityVulnerability {
              package {
                name
              }
              vulnerableVersionRange
                firstPatchedVersion {
                  identifier
                }
            }
            vulnerableManifestFilename
            vulnerableManifestPath
          }
        }
      }
    }`

  // Our CSV output fields
  const fields = [
    {
      label: 'Manifest',
      value: 'vulnerableManifestPath'
    },
    {
      label: 'Package Name',
      value: 'securityVulnerability.package.name'
    },
    {
      label: 'Impacted Version',
      value: 'securityVulnerability.vulnerableVersionRange'
    },
    {
      label: 'Patched Version',
      value: 'securityVulnerability.firstPatchedVersion.identifier'
    },
    {
      label: 'Severity',
      value: 'securityAdvisory.severity'
    },
    {
      label: 'Summary',
      value: 'securityAdvisory.summary'
    },
    {
      label: 'CVE Link',
      value: 'securityAdvisory.permalink'
    },
    {
      label: 'Alert Link',
      value: row => `https://github.com/${row.repository.owner.login}/${row.repository.name}/security/dependabot/${row.number}`
    }
  ];

// graphql query execution
async function getAlerts(org, repo, pagination) {
  try {
    console.log(`getAlerts(): pagination: ${pagination ? pagination: null}` );

    return await octokit.graphql(query, { org_name: `${org}`, repo_name: `${repo}`, pagination: (pagination ? `${pagination}` : null) });
  } catch (error) {
    core.setFailed(error.message);
  }
}

// Extract vulnerability alerts with a pagination of 50 alerts per page
async function run(org_Name, repo_Name, csv_path) {

  let pagination = null;
  let hasNextPage = false;
  let addTitleRow = true;
  let alertCount =0 ;

  try {
    await makeDir(dirname(csv_path));
    do {
      // invoke the graphql query execution
      await getAlerts(org_Name, repo_Name, pagination).then(alertResult => {
        let vulnerabilityNodes = alertResult.repository.vulnerabilityAlerts.nodes;

        // Filter for CRITICAL or HIGH severity and RUNTIME scope
        vulnerabilityNodes = vulnerabilityNodes.filter(
          node =>
            (node.securityAdvisory.severity === 'CRITICAL' || node.securityAdvisory.severity === 'HIGH') &&
            node.dependencyScope === 'RUNTIME' &&
            !node.fixedAt &&
            !node.dismissedAt
        );

        if(addTitleRow){
          alertCount = alertResult.repository.vulnerabilityAlerts.totalCount;
          console.log ('Alert Count ' + alertCount);
        }

        // ALERT! - create our updated opts
        const opts = { fields, "header": addTitleRow };

        // append to the existing file (or create and append if needed)
        require("fs").appendFileSync(csv_path, `${parse(vulnerabilityNodes, opts)}\n`);

        // pagination to get next page data
        let pageInfo = alertResult.repository.vulnerabilityAlerts.pageInfo;
        hasNextPage = pageInfo.hasNextPage;
        if (hasNextPage) {
          pagination = pageInfo.endCursor;
          addTitleRow = false;
        }
        console.log(`run(): hasNextPage:  ${hasNextPage}`);
        console.log(`run(): Pagination cursor: ${pagination}`);
        console.log(`run(): addTitleRow: ${addTitleRow}`);

      });

       core.setOutput('alerts_count', alertCount)

    } while (hasNextPage);
  } catch (error) {
    core.setFailed(error.message);
  }
}

console.log(`preamble: org name: ${org_Name}   repo name: ${repo_Name}`);

// run the action code
run(org_Name, repo_Name, csv_path);
