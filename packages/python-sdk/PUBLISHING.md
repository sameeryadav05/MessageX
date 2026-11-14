# Publishing the MessageX Python SDK to PyPI

This guide explains how to release the `messagex-client` distribution. The import name is
`messagex`; the package distribution name is `messagex-client`.

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

## 3. Create package-index accounts and check the name

1. Create or sign in to an account at https://pypi.org/account/register/.
2. Create or sign in to a separate account at https://test.pypi.org/account/register/.
3. Enable two-factor authentication on both accounts.
4. Check https://pypi.org/project/messagex-client/ and
   https://test.pypi.org/project/messagex-client/ before publishing.
5. If the name is already owned by someone else on either index, do not try to claim or
   impersonate that project. Choose a distinct distribution name and update metadata,
   documentation and workflows consistently.

## 4. Publish to TestPyPI first

The repository includes `.github/workflows/publish-python-sdk-testpypi.yml`. It is a
manual-only workflow that runs the SDK tests, builds the distributions, validates them,
and publishes to TestPyPI. It does not publish to production PyPI.

Configure a TestPyPI Trusted Publisher:

1. Open https://test.pypi.org/manage/account/publishing/ and sign in.
2. Add a pending GitHub Actions publisher with:
   - Project name: `messagex-client`
   - Owner: `sameeryadav05`
   - Repository: `MessageX`
   - Workflow filename: `publish-python-sdk-testpypi.yml`
   - Environment name: `testpypi`
3. In GitHub, open **Settings → Environments** and create an environment named
   `testpypi`. No production deployment approval is needed for this test environment.
4. Open **Actions → Publish Python SDK to TestPyPI → Run workflow** and select the
   `tilak` branch. Run it only after the pending publisher and environment are configured.

The first successful trusted publish creates the TestPyPI project and converts the pending
publisher into a normal publisher. TestPyPI is separate from production PyPI.

If you prefer manual upload instead, create a TestPyPI API token and run:

```bash
python -m twine upload --repository testpypi packages/python-sdk/dist/*
```

Use username `__token__` and the token as the password when prompted. Never paste tokens
into source files, shell history, issues or chat.

### Install and verify the TestPyPI package

Use a clean virtual environment. On Windows PowerShell:

```powershell
py -m venv .venv-pypi-test
.\.venv-pypi-test\Scripts\Activate.ps1
python -m pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ messagex-client
python -c "from messagex import MessageX; print(MessageX)"
```

Then test a producer/consumer flow against a reachable MessageX broker. Installing the
package proves distribution availability, not broker compatibility.

## 5. Configure production PyPI Trusted Publishing

The production workflow is `.github/workflows/publish-python-sdk.yml`. It publishes to
production PyPI, so do not run it until the release is approved.

1. Open https://pypi.org/manage/account/publishing/ and sign in.
2. Add a pending GitHub Actions publisher with:
   - Project name: `messagex-client`
   - Owner: `sameeryadav05`
   - Repository: `MessageX`
   - Workflow filename: `publish-python-sdk.yml`
   - Environment name: `pypi`
3. In GitHub, open **Settings → Environments** and create an environment named `pypi`.
   Require manual approval from a trusted reviewer for production publishing.
4. Keep workflow permissions limited to `contents: read` and `id-token: write`.
   Do not add a PyPI password or API token to GitHub secrets when using trusted publishing.

The production workflow is triggered by a tag matching `python-v*`, or by manual dispatch.
The tag trigger must only be used after the reviewed release commit is on `main`.

## 6. Release a new version

Before creating a production release:

1. Ensure the Python SDK has passed its Python 3.9–3.13 test matrix, TestPyPI install
   verification, and real-broker compatibility tests.
2. Update `version` in `pyproject.toml` and `__version__` in
   `src/messagex/__init__.py` to the same new version.
3. Update release notes and verify the package README and metadata.
4. Merge the reviewed SDK changes into `main`.
5. Create and push a tag from the approved release commit, for example:

```bash
git checkout main
git pull
git tag python-v0.1.1
git push origin python-v0.1.1
```

6. Watch **Publish Python SDK to PyPI**. Do not announce the release unless the workflow
   succeeds and the project page shows the expected version and files.

## 7. Verify the production install

On a clean machine or virtual environment:

```bash
python -m pip install --upgrade messagex-client
python -c "from messagex import MessageX; print(MessageX)"
```

Then run a small producer/consumer test against a reachable MessageX broker.

## 8. What users install

After a successful production release, users install the distribution with:

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
