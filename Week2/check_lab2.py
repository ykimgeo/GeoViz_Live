import sys
import platform
import subprocess
from importlib import import_module
REQUIRED = ["numpy", "pandas"]
def header(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)

def run_cmd(cmd):
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True)
        return True, out.strip()
    except Exception as e:
        return False, str(e)

def check_import(pkg):
    try:
        m = import_module(pkg)
        ver = getattr(m, "__version__", "unknown")
        return True, ver
    except Exception as e:
        return False, str(e)

def numpy_pandas_smoke_tests():
    import numpy as np
    import pandas as pd

    header("NumPy smoke tests")
    a = np.arange(1, 13).reshape(3, 4)
    print("Array a:\n", a)
    print("Shape:", a.shape)
    print("Mean (axis=0):", a.mean(axis=0))
    mask = a % 2 == 0
    print("Even mask sum:", mask.sum())
    b = a * 2 + 1 # broadcasting-ish arithmetic
    print("b = a*2+1, last row:", b[-1, :])
    
    header("Pandas smoke tests")
    df = pd.DataFrame({
        "id": [1, 2, 3, 4, 5],
        "group": ["A", "A", "B", "B", "B"],
        "value": [10, 12, 9, None, 15]
    })
    print("DF:\n", df)
    print("\nMissing values per column:\n", df.isna().sum())
    
    # basic cleaning + groupby summary
    df["value_filled"] = df["value"].fillna(df["value"].median())
    summary = df.groupby("group")["value_filled"].agg(["count", "mean", "min", "max"])
    print("\nGroup summary:\n", summary)

    # save + reload to ensure IO works
    out_csv = "lab2_test_output.csv"
    df.to_csv(out_csv, index=False)
    df2 = pd.read_csv(out_csv)
    print("\nReloaded CSV head:\n", df2.head())

def main():
    header("System info")
    print("Python:", sys.version.replace("\n", " "))
    print("Executable:", sys.executable)
    print("Platform:", platform.platform())

    header("Package import checks")
    ok_all = True
    for pkg in REQUIRED:
        ok, info = check_import(pkg)
        print(f"{pkg:10s}:", "OK" if ok else "FAIL", "|", info)
        ok_all = ok_all and ok

    header("Jupyter checks")
    ok_jup, jup_ver = run_cmd(["jupyter", "--version"])
    print("jupyter --version:", "OK" if ok_jup else "FAIL")
    print(jup_ver)

    ok_lab, lab_ver = run_cmd(["jupyter", "lab", "--version"])
    print("\njupyter lab --version:", "OK" if ok_lab else "FAIL")
    print(lab_ver)

    # Kernel list (nice-to-have; some systems may block)
    ok_k, kernels = run_cmd(["jupyter", "kernelspec", "list"])
    print("\njupyter kernelspec list:", "OK" if ok_k else "FAIL")
    print(kernels)

    if ok_all:
        numpy_pandas_smoke_tests()
        header("RESULT")
        print("All required imports worked and smoke tests completed.")
        print("Next: export your environment.yml and submit deliverables.")
    else:
        header("RESULT")
        print("One or more required imports failed.")
        print("Fix the environment, then rerun: python check_lab2.py")
        sys.exit()

if __name__ == "__main__":
    main()
