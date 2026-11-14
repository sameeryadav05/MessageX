# Publishing the MessageX Python SDK to PyPI

This guide explains how to release the `messagex-client` distribution. The import name is
`messagex`; the PyPI distribution name is `messagex-client`.

## 1. Check the package metadata

From `packages/python-sdk/`, review:

- `pyproject.toml`: distribution name, version, Python requirement, license and project URLs.
- `README.md`: the package description shown on PyPI.
- `LICENSE`: license included in the distributions.
- `src/messagex/py.typed`: marks the package as typed.

The version in `pyproject.toml` and `src/messagex/__init__.py` must match.
Never reuse a version already uploaded to PyPI. Increment both values for every release.

## 2. Run tests and build locally

Use Python 3.9 or newer. From the repository root:

```bash
python -m pip install --upgrade pip build twine
python -m pip install -e ./packages/python-sdk
cd packages/python-sdk
PYTHONPATH=src:tests python -m unittest discover -s tests -v
cd ../..
python -m build packages/python-sdk
python -m twine check packages/python-sdk/dist/*
```

Inspect the wheel and source archive in `packages/python-sdk/dist/`. Confirm they contain
`messagex/`, `py.typed`, the license and README, and do not contain secrets, local
configuration, tests, or generated `.egg-info` directories committed from a developer machine.

## 3. Create PyPI accounts and reserve the project name

1. Create or sign in to an account at https://pypi.org/account/register/.
2. Enable two-factor authentication.
3. Check https://pypi.org/project/messagex-client/ to see whether the name is available.
4. If it is already owned by someone else, do not try to claim or impersonate that project.
   Choose a distinct distribution name and update `pyproject.toml`, docs and workflow consistently.
5. If available, create the project by its first upload to TestPyPI/PyPI as described below.

## 4. Test the distribution on TestPyPI first

1. Create an account at https://test.pypi.org/account/register/.
2. Create a TestPyPI API token at https://test.pypi.org/manage/account/#api-tokens.
3. Build fresh distributions (step 2).
4. Upload to TestPyPI:

```bash
python -m twine upload --repository testpypi packages/python-sdk/dist/*
```

When prompted for credentials, use username `__token__` and the TestPyPI token as the password.
Do not paste tokens into source files, shell history, issues, or chat.

5. Install into a clean virtual environment and verify the public install path:

```bash
python -m venv .venv-pypi-test
# Linux/macOS:
source .venv-pypi-test/bin/activate
# Windows PowerShell:
# .venv-pypi-test\Scripts\Activate.ps1
python -m pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ messagex-client
python -c "from messagex import MessageX; print(MessageX)"
```

TestPyPI is a separate index and is not the production package index.

## 5. Configure PyPI Trusted Publishing (recommended)

The repository includes `.github/workflows/publish-python-sdk.yml`. Configure a PyPI
Trusted Publisher so GitHub Actions can publish using short-lived OIDC credentials instead
of a long-lived PyPI token.

1. Sign in to PyPI and open the project settings for `messagex-client`. For the first
   release, use PyPI's pending publisher setup if the project has not been created yet.
2. Add a GitHub Actions trusted publisher with:
   - Owner: `sameeryadav05`
   - Repository: `MessageX`
   - Workflow filename: `publish-python-sdk.yml`
   - Environment name: `pypi`
3. In GitHub, open **Settings → Environments** and create an environment named `pypi`.
   Add required reviewers if you want a manual approval gate.
4. Keep the workflow permissions limited to `contents: read` and `id-token: write`.
   Do not add a PyPI password or API token to GitHub secrets when using trusted publishing.

The workflow builds and tests the package, validates the distributions, then publishes them.
A tag matching `python-v*` triggers the release workflow. A manual run is also available
from **Actions → Publish Python SDK to PyPI → Run workflow**.

## 6. Release a new version

Before creating a release:

1. Ensure the Python SDK has passed its test matrix and a real-broker compatibility test.
2. Update `version` in `pyproject.toml` and `__version__` in `src/messagex/__init__.py`
   to the same new version.
3. Update release notes and verify the package README and metadata.
4. Merge the reviewed SDK changes into `main`.
5. Create and push a tag from the release commit, for example:

```bash
git checkout main
git pull
git tag python-v0.1.1
git push origin python-v0.1.1
```

6. Watch the **Publish Python SDK to PyPI** workflow. Do not announce the release unless the
   workflow succeeds and the project page shows the expected version and files.

## 7. Verify the production install

On a clean machine or virtual environment:

```bash
python -m pip install --upgrade messagex-client
python -c "from messagex import MessageX; print(MessageX)"
```

Then run a small producer/consumer test against a reachable MessageX broker. Installing the
package only proves distribution availability; it does not prove broker connectivity or
protocol compatibility.

## 8. What users install

After a successful release, users install the distribution with:

```bash
python -m pip install messagex-client
```

And import it with:

```python
from messagex import MessageX
```

The SDK is an asyncio TCP client. Users still need a running MessageX broker and valid broker
credentials. The broker's TCP transport currently has no TLS, so deployments should use a
private network, VPN or SSH tunnel rather than exposing port 5678 to the public internet.
