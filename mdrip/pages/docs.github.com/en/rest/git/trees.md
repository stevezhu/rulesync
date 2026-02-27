# REST API endpoints for Git trees - GitHub Docs

The REST API is now versioned. For more information, see "[About API versioning](https://docs.github.com/rest/overview/api-versions)."

# REST API endpoints for Git trees

Use the REST API to interact with tree objects in your Git database on GitHub.

## [About Git trees](https://docs.github.com/en/rest/git/trees#about-git-trees)

A Git tree object creates the hierarchy between files in a Git repository. You can use the Git tree object to create the relationship between directories and the files they contain. These endpoints allow you to read and write [tree objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects#_tree_objects) to your Git database on GitHub.

## [Create a tree](https://docs.github.com/en/rest/git/trees#create-a-tree)

The tree creation API accepts nested entries. If you specify both a tree and a nested path modifying that tree, this endpoint will overwrite the contents of the tree with the new path contents, and create a new tree structure.

If you use this endpoint to add, delete, or modify the file contents in a tree, you will need to commit the tree and then update a branch to point to the commit. For more information see "[Create a commit](https://docs.github.com/rest/git/commits#create-a-commit)" and "[Update a reference](https://docs.github.com/rest/git/refs#update-a-reference)."

Returns an error if you try to delete a file that does not exist.

### [Fine-grained access tokens for "Create a tree"](https://docs.github.com/en/rest/git/trees#create-a-tree--fine-grained-access-tokens)

This endpoint works with the following fine-grained token types:

- [GitHub App user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub App installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)

The fine-grained token must have the following permission set:

- "Contents" repository permissions (write)

### [Parameters for "Create a tree"](https://docs.github.com/en/rest/git/trees#create-a-tree--parameters)

| Name, Type, Description                                                  |
| ------------------------------------------------------------------------ |
| `accept` string Setting to `application/vnd.github+json` is recommended. |

| Name, Type, Description                                                                                         |
| --------------------------------------------------------------------------------------------------------------- |
| `owner` string Required The account owner of the repository. The name is not case sensitive.                    |
| `repo` string Required The name of the repository without the `.git` extension. The name is not case sensitive. |

| Name, Type, Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | --- | --- | --- | ---------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| `tree` array of objects Required Objects (of `path`, `mode`, `type`, and `sha`) specifying a tree structure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Properties of `tree`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Name, Type, Description |     | --- |     | `path` string The file referenced in the tree. |     | `mode` string The file mode; one of `100644` for file (blob), `100755` for executable (blob), `040000` for subdirectory (tree), `160000` for submodule (commit), or `120000` for a blob that specifies the path of a symlink. Can be one of: `100644`, `100755`, `040000`, `160000`, `120000` |     | `type` string Either `blob`, `tree`, or `commit`. Can be one of: `blob`, `tree`, `commit` |     | `sha` string or null The SHA1 checksum ID of the object in the tree. Also called `tree.sha`. If the value is `null` then the file will be deleted. **Note:** Use either `tree.sha` or `content` to specify the contents of the entry. Using both `tree.sha` and `content` will return an error. |     | `content` string The content you want this file to have. GitHub will write this blob out and use that SHA for this entry. Use either this, or `tree.sha`. **Note:** Use either `tree.sha` or `content` to specify the contents of the entry. Using both `tree.sha` and `content` will return an error. |     |
| `base_tree` string The SHA1 of an existing Git tree object which will be used as the base for the new tree. If provided, a new Git tree object will be created from entries in the Git tree object pointed to by `base_tree` and entries defined in the `tree` parameter. Entries defined in the `tree` parameter will overwrite items from `base_tree` with the same `path`. If you're creating new changes on a branch, then normally you'd set `base_tree` to the SHA1 of the Git tree object of the current latest commit on the branch you're working on. If not provided, GitHub will create a new Git tree object from only the entries defined in the `tree` parameter. If you create a new commit pointing to such a tree, then all files which were a part of the parent commit's tree and were not defined in the `tree` parameter will be listed as deleted by the new commit. |

### [HTTP response status codes for "Create a tree"](https://docs.github.com/en/rest/git/trees#create-a-tree--status-codes)

| Status code | Description                                          |
| ----------- | ---------------------------------------------------- |
| `201`       | Created                                              |
| `403`       | Forbidden                                            |
| `404`       | Resource not found                                   |
| `409`       | Conflict                                             |
| `422`       | Validation failed, or the endpoint has been spammed. |

### [Code samples for "Create a tree"](https://docs.github.com/en/rest/git/trees#create-a-tree--code-samples)

#### Request example

post/repos/{owner}/{repo}/git/trees

-
-
-

`curl -L \ -X POST \ -H "Accept: application/vnd.github+json" \ -H "Authorization: Bearer <YOUR-TOKEN>" \ -H "X-GitHub-Api-Version: 2022-11-28" \ https://api.github.com/repos/OWNER/REPO/git/trees \ -d '{"base_tree":"9fb037999f264ba9a7fc6274d15fa3ae2ab98312","tree":[{"path":"file.rb","mode":"100644","type":"blob","sha":"44b4fc6d56897b048c772eb4087f854f46256132"}]}'`

#### Response

-
-

`Status: 201`

`{ "sha": "cd8274d15fa3ae2ab983129fb037999f264ba9a7", "url": "https://api.github.com/repos/octocat/Hello-World/trees/cd8274d15fa3ae2ab983129fb037999f264ba9a7", "tree": [ { "path": "file.rb", "mode": "100644", "type": "blob", "size": 132, "sha": "7c258a9869f33c1e1e1f74fbb32f07c86cb5a75b", "url": "https://api.github.com/repos/octocat/Hello-World/git/blobs/7c258a9869f33c1e1e1f74fbb32f07c86cb5a75b" } ], "truncated": true }`

## [Get a tree](https://docs.github.com/en/rest/git/trees#get-a-tree)

Returns a single tree using the SHA1 value or ref name for that tree.

If `truncated` is `true` in the response then the number of items in the `tree` array exceeded our maximum limit. If you need to fetch more items, use the non-recursive method of fetching trees, and fetch one sub-tree at a time.

Note

The limit for the `tree` array is 100,000 entries with a maximum size of 7 MB when using the `recursive` parameter.

### [Fine-grained access tokens for "Get a tree"](https://docs.github.com/en/rest/git/trees#get-a-tree--fine-grained-access-tokens)

This endpoint works with the following fine-grained token types:

- [GitHub App user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub App installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)

The fine-grained token must have the following permission set:

- "Contents" repository permissions (read)

This endpoint can be used without authentication or the aforementioned permissions if only public resources are requested.

### [Parameters for "Get a tree"](https://docs.github.com/en/rest/git/trees#get-a-tree--parameters)

| Name, Type, Description                                                  |
| ------------------------------------------------------------------------ |
| `accept` string Setting to `application/vnd.github+json` is recommended. |

| Name, Type, Description                                                                                         |
| --------------------------------------------------------------------------------------------------------------- |
| `owner` string Required The account owner of the repository. The name is not case sensitive.                    |
| `repo` string Required The name of the repository without the `.git` extension. The name is not case sensitive. |
| `tree_sha` string Required The SHA1 value or ref (branch or tag) name of the tree.                              |

| Name, Type, Description                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recursive` string Setting this parameter to any value returns the objects or subtrees referenced by the tree specified in `:tree_sha`. For example, setting `recursive` to any of the following will enable returning objects or subtrees: `0`, `1`, `"true"`, and `"false"`. Omit this parameter to prevent recursively returning objects or subtrees. |

### [HTTP response status codes for "Get a tree"](https://docs.github.com/en/rest/git/trees#get-a-tree--status-codes)

| Status code | Description                                          |
| ----------- | ---------------------------------------------------- |
| `200`       | OK                                                   |
| `404`       | Resource not found                                   |
| `409`       | Conflict                                             |
| `422`       | Validation failed, or the endpoint has been spammed. |

### [Code samples for "Get a tree"](https://docs.github.com/en/rest/git/trees#get-a-tree--code-samples)

#### Request examples

Select the example type

get/repos/{owner}/{repo}/git/trees/{tree_sha}

-
-
-

`curl -L \ -H "Accept: application/vnd.github+json" \ -H "Authorization: Bearer <YOUR-TOKEN>" \ -H "X-GitHub-Api-Version: 2022-11-28" \ https://api.github.com/repos/OWNER/REPO/git/trees/TREE_SHA`

#### Default response

-
-

`Status: 200`

`{ "sha": "9fb037999f264ba9a7fc6274d15fa3ae2ab98312", "url": "https://api.github.com/repos/octocat/Hello-World/trees/9fb037999f264ba9a7fc6274d15fa3ae2ab98312", "tree": [ { "path": "file.rb", "mode": "100644", "type": "blob", "size": 30, "sha": "44b4fc6d56897b048c772eb4087f854f46256132", "url": "https://api.github.com/repos/octocat/Hello-World/git/blobs/44b4fc6d56897b048c772eb4087f854f46256132" }, { "path": "subdir", "mode": "040000", "type": "tree", "sha": "f484d249c660418515fb01c2b9662073663c242e", "url": "https://api.github.com/repos/octocat/Hello-World/git/blobs/f484d249c660418515fb01c2b9662073663c242e" }, { "path": "exec_file", "mode": "100755", "type": "blob", "size": 75, "sha": "45b983be36b73c0788dc9cbcb76cbb80fc7bb057", "url": "https://api.github.com/repos/octocat/Hello-World/git/blobs/45b983be36b73c0788dc9cbcb76cbb80fc7bb057" } ], "truncated": false }`
