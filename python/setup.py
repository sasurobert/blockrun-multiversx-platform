from setuptools import setup, find_packages

setup(
    name="multiversx-x402",
    version="1.0.0",
    description="MultiversX Autonomous AI Agent Client SDK for x402 Micropayments, Tollbooth, and MCP on Devnet",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="Robert Sasu",
    author_email="sasu.robert@gmail.com",
    license="MIT",
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=[
        "pynacl>=1.5.0",
    ],
    extras_require={
        "dev": ["pytest>=7.0.0"],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
)
